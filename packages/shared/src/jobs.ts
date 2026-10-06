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
  /** 1 for webhook-driven reviews; a manual rerun uses the next attempt (ADR-031). */
  attempt: z.number().int().positive().default(1),
});
export type ReviewPrJobData = z.infer<typeof ReviewPrJobDataSchema>;
export type ReviewPrJobInput = z.input<typeof ReviewPrJobDataSchema>;

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

export const INDEX_TRIGGERS = ['push', 'installation', 'manual'] as const;
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

/**
 * `<githubRepoId>@<commitSha>`, `<githubRepoId>@initial` for the first index (ADR-024), or
 * `<githubRepoId>@manual-<yyyymmddHHMM>` for a reindex asked from the UI: one per minute, so a
 * double click is deduplicated but a later reindex is not (ADR-031).
 */
export function buildIndexJobId(input: {
  githubRepoId: number;
  commitSha: string | null;
  trigger?: IndexTrigger;
  requestedAt?: Date;
}): string {
  if (input.trigger === 'manual') {
    const minute = (input.requestedAt ?? new Date())
      .toISOString()
      .slice(0, 16)
      .replace(/[-T:]/g, '');
    return `${input.githubRepoId}@manual-${minute}`;
  }
  return `${input.githubRepoId}@${input.commitSha ?? 'initial'}`;
}

export const CI_OUTCOMES = ['failed', 'passed'] as const;
export type CiOutcome = (typeof CI_OUTCOMES)[number];

/** Data carried by a `ci-summary.run` job (PRD F10, ADR-028). */
export const CiSummaryJobDataSchema = z.object({
  githubInstallationId: z.number().int().positive(),
  githubRepoId: z.number().int().positive(),
  repoFullName: z.string().min(1),
  isPrivate: z.boolean(),
  workflowRunId: z.number().int().positive(),
  workflowId: z.number().int().positive(),
  workflowName: z.string().min(1),
  runNumber: z.number().int().positive(),
  runAttempt: z.number().int().positive(),
  headSha: GitShaSchema,
  headBranch: z.string().nullable(),
  htmlUrl: z.url(),
  outcome: z.enum(CI_OUTCOMES),
  /** PRs GitHub linked to the run; empty for fork PRs, which the worker looks up by SHA. */
  prNumbers: z.array(z.number().int().positive()).max(20),
});
export type CiSummaryJobData = z.infer<typeof CiSummaryJobDataSchema>;

/**
 * `<githubRepoId>#run<workflowRunId>-<runAttempt>`: a re-run keeps the run id and bumps the
 * attempt, so each attempt is summarised once. BullMQ forbids ':'.
 */
export function buildCiSummaryJobId(input: {
  githubRepoId: number;
  workflowRunId: number;
  runAttempt: number;
}): string {
  return `${input.githubRepoId}#run${input.workflowRunId}-${input.runAttempt}`;
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
