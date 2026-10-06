import { z } from 'zod';

import { REVIEW_TRIGGERS, type ReviewTrigger } from './domain.js';
import { GitShaSchema } from './github/webhook-payloads.js';

/** Data carried by a `review.pr` job; parsed again when the worker dequeues it (rules.md §3). */
export const ReviewPrJobDataSchema = z.object({
  deliveryId: z.string().min(1),
  githubInstallationId: z.number().int().positive(),
  githubRepoId: z.number().int().positive(),
  repoFullName: z.string().min(1),
  isPrivate: z.boolean(),
  defaultBranch: z.string().min(1),
  prNumber: z.number().int().positive(),
  title: z.string(),
  authorLogin: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  baseSha: GitShaSchema,
  headSha: GitShaSchema,
  isDraft: z.boolean(),
  trigger: z.enum(REVIEW_TRIGGERS),
  githubUpdatedAt: z.iso.datetime({ offset: true }),
});
export type ReviewPrJobData = z.infer<typeof ReviewPrJobDataSchema>;

export type ReviewJobIdInput = {
  githubRepoId: number;
  prNumber: number;
  headSha: string;
  trigger?: ReviewTrigger;
  attempt?: number;
};

/**
 * `<githubRepoId>#<prNumber>@<headSha>`, plus `-ready` for `ready_for_review` and `-a<attempt>`
 * for manual reruns (ADR-017, ADR-018). Deterministic so BullMQ drops duplicate enqueues.
 * `ready_for_review` gets its own id: a draft's `opened` job at the same SHA was skipped, and
 * sharing its id would make BullMQ drop the job that should review the PR. BullMQ forbids ':'.
 */
export function buildReviewJobId({
  githubRepoId,
  prNumber,
  headSha,
  trigger,
  attempt = 1,
}: ReviewJobIdInput): string {
  const base = `${githubRepoId}#${prNumber}@${headSha}${trigger === 'ready_for_review' ? '-ready' : ''}`;
  return attempt > 1 ? `${base}-a${attempt}` : base;
}

export const INDEX_TRIGGERS = ['push', 'installation'] as const;
export type IndexTrigger = (typeof INDEX_TRIGGERS)[number];

/** Data carried by an `index.repo` job (PRD F6). */
export const IndexRepoJobDataSchema = z.object({
  githubInstallationId: z.number().int().positive(),
  githubRepoId: z.number().int().positive(),
  repoFullName: z.string().min(1),
  isPrivate: z.boolean(),
  /** Known for pushes; installation payloads omit it, so the worker asks GitHub. */
  defaultBranch: z.string().min(1).nullable(),
  /** The pushed head, or null for the first index after installation. */
  commitSha: GitShaSchema.nullable(),
  trigger: z.enum(INDEX_TRIGGERS),
});
export type IndexRepoJobData = z.infer<typeof IndexRepoJobDataSchema>;

/** `<githubRepoId>@<commitSha>`, or `<githubRepoId>@initial` for the first index (ADR-024). */
export function buildIndexJobId(input: { githubRepoId: number; commitSha: string | null }): string {
  return `${input.githubRepoId}@${input.commitSha ?? 'initial'}`;
}

const SECONDS_PER_DAY = 86_400;

/**
 * Per-queue BullMQ job options (Architecture.md §5). Completed jobs are kept for a day so their
 * deterministic id keeps deduplicating late redeliveries; failed jobs stay a week for debugging.
 */
export const QUEUE_JOB_OPTIONS = {
  review: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000, jitter: 0.5 },
    removeOnComplete: { age: SECONDS_PER_DAY },
    removeOnFail: { age: 7 * SECONDS_PER_DAY },
  },
  index: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000, jitter: 0.5 },
    removeOnComplete: { age: SECONDS_PER_DAY },
    removeOnFail: { age: 7 * SECONDS_PER_DAY },
  },
  ciSummary: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000, jitter: 0.5 },
    removeOnComplete: { age: SECONDS_PER_DAY },
    removeOnFail: { age: 7 * SECONDS_PER_DAY },
  },
} as const;
