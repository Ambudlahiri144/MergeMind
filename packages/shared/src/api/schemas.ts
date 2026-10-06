import { z } from 'zod';

import { LLM_PROVIDER_NAMES } from '../constants.js';
import {
  ACCOUNT_TYPES,
  FINDING_STATES,
  GATE_CONCLUSIONS,
  INDEX_STATUSES,
  INSTALLATION_STATUSES,
  PULL_REQUEST_STATES,
  REVIEW_PASSES,
  REVIEW_RUN_MODES,
  REVIEW_RUN_STATUSES,
  REVIEW_TRIGGERS,
  SEVERITIES,
  SKIP_REASONS,
  USAGE_KINDS,
} from '../domain.js';
import { FINDING_CATEGORIES } from '../review/findings.js';
import { GATE_FAIL_ON } from '../review/policy.js';

// HTTP contract of `/api/v1` (Architecture.md §5). The api validates requests with these and the
// web parses responses with them, so both sides agree on one definition (rules.md §3).

export const ObjectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, 'must be a 24-char hex id');

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

// --- params ---

export const InstallationParamsSchema = z.object({ installationId: ObjectIdSchema });
export const RepositoryParamsSchema = z.object({ repositoryId: ObjectIdSchema });
export const PullParamsSchema = z.object({
  repositoryId: ObjectIdSchema,
  number: z.coerce.number().int().positive(),
});
export const RunParamsSchema = z.object({ runId: ObjectIdSchema });
export const FindingParamsSchema = z.object({ findingId: ObjectIdSchema });

// --- queries and bodies ---

export const PULL_LIST_STATES = [...PULL_REQUEST_STATES, 'all'] as const;
export const PullListQuerySchema = PageQuerySchema.extend({
  state: z.enum(PULL_LIST_STATES).default('open'),
});
export type PullListQuery = z.infer<typeof PullListQuerySchema>;

export const UpdateRepositoryBodySchema = z.object({ isEnabled: z.boolean() }).strict();
export type UpdateRepositoryBody = z.infer<typeof UpdateRepositoryBodySchema>;

export const MAX_DISMISS_REASON_LENGTH = 500;
export const DismissFindingBodySchema = z
  .object({
    state: z.literal('dismissed'),
    reason: z.string().trim().min(1).max(MAX_DISMISS_REASON_LENGTH).optional(),
  })
  .strict();
export type DismissFindingBody = z.infer<typeof DismissFindingBodySchema>;

export const MAX_MONTHLY_TOKEN_BUDGET = 1_000_000_000;
export const UpdateBudgetBodySchema = z
  .object({ monthlyTokenBudget: z.number().int().min(0).max(MAX_MONTHLY_TOKEN_BUDGET) })
  .strict();
export type UpdateBudgetBody = z.infer<typeof UpdateBudgetBodySchema>;

// --- responses ---

const DateTimeSchema = z.iso.datetime({ offset: true });
const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const INSTALLATION_ROLES = ['owner', 'admin', 'member'] as const;
export type InstallationRole = (typeof INSTALLATION_ROLES)[number];

export const MeResponseSchema = z.object({
  user: z.object({ githubUserId: z.number().int().positive(), login: z.string().min(1) }),
  installations: z.array(
    z.object({
      id: ObjectIdSchema,
      githubInstallationId: z.number().int().positive(),
      accountLogin: z.string(),
      accountType: z.enum(ACCOUNT_TYPES),
      status: z.enum(INSTALLATION_STATUSES),
      role: z.enum(INSTALLATION_ROLES),
      allowedProviders: z.array(z.enum(LLM_PROVIDER_NAMES)),
    }),
  ),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

const SeverityCountsSchema = z.object({
  critical: z.number().int(),
  major: z.number().int(),
  minor: z.number().int(),
  resolved: z.number().int(),
});

export const RunSummarySchema = z.object({
  id: ObjectIdSchema,
  headSha: ShaSchema,
  attempt: z.number().int().positive(),
  trigger: z.enum(REVIEW_TRIGGERS),
  mode: z.enum(REVIEW_RUN_MODES),
  status: z.enum(REVIEW_RUN_STATUSES),
  gateConclusion: z.enum(GATE_CONCLUSIONS).nullable(),
  skipReason: z.enum(SKIP_REASONS).nullable(),
  counts: SeverityCountsSchema,
  durationMs: z.number().int().nonnegative(),
  createdAt: DateTimeSchema,
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RepositoryItemSchema = z.object({
  id: ObjectIdSchema,
  installationId: ObjectIdSchema,
  fullName: z.string(),
  isPrivate: z.boolean(),
  isEnabled: z.boolean(),
  isInstalled: z.boolean(),
  indexStatus: z.enum(INDEX_STATUSES),
  defaultBranch: z.string().nullable(),
  openPullRequests: z.number().int().nonnegative(),
  lastReviewAt: DateTimeSchema.nullable(),
});
export type RepositoryItem = z.infer<typeof RepositoryItemSchema>;
export const RepositoryPageSchema = pageSchema(RepositoryItemSchema);

export const PullRequestItemSchema = z.object({
  id: ObjectIdSchema,
  number: z.number().int().positive(),
  title: z.string(),
  authorLogin: z.string(),
  baseRef: z.string(),
  headRef: z.string(),
  headSha: ShaSchema,
  state: z.enum(PULL_REQUEST_STATES),
  isDraft: z.boolean(),
  updatedAt: DateTimeSchema,
  latestRun: RunSummarySchema.nullable(),
});
export type PullRequestItem = z.infer<typeof PullRequestItemSchema>;
export const PullRequestPageSchema = pageSchema(PullRequestItemSchema);

const RepositoryRefSchema = z.object({ id: ObjectIdSchema, fullName: z.string() });

export const PullRequestDetailSchema = PullRequestItemSchema.omit({ latestRun: true }).extend({
  repository: RepositoryRefSchema,
  htmlUrl: z.url(),
  runs: z.array(RunSummarySchema),
});
export type PullRequestDetail = z.infer<typeof PullRequestDetailSchema>;

export const FindingItemSchema = z.object({
  id: ObjectIdSchema,
  pass: z.enum(REVIEW_PASSES),
  severity: z.enum(SEVERITIES),
  confidence: z.number(),
  category: z.enum(FINDING_CATEGORIES),
  path: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  suggestion: z.string().nullable(),
  state: z.enum(FINDING_STATES),
  placement: z.enum(['inline', 'summary']),
  githubUrl: z.url(),
});
export type FindingItem = z.infer<typeof FindingItemSchema>;

export const RunDetailSchema = RunSummarySchema.extend({
  baseSha: ShaSchema,
  promptVersion: z.string(),
  repository: RepositoryRefSchema,
  pullRequest: z.object({
    id: ObjectIdSchema,
    number: z.number().int().positive(),
    title: z.string(),
    state: z.enum(PULL_REQUEST_STATES),
    headSha: ShaSchema,
  }),
  policyErrors: z.array(z.string()),
  failedPasses: z.array(z.enum(REVIEW_PASSES)),
  isBudgetWarning: z.boolean(),
  /** Findings below the confidence bar: counted, never listed (PRD F8). */
  filteredCount: z.number().int().nonnegative(),
  /** True when this is the PR's newest head and the PR is open (rerun allowed). */
  canRerun: z.boolean(),
  findings: z.array(FindingItemSchema),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const EffectivePolicySchema = z.object({
  version: z.literal(1),
  review: z.object({
    enabled: z.boolean(),
    passes: z.array(z.enum(REVIEW_PASSES)),
    minConfidence: z.number(),
    maxChangedLines: z.number().int(),
    skipDrafts: z.boolean(),
    ignorePaths: z.array(z.string()),
  }),
  gate: z.object({ failOn: z.enum(GATE_FAIL_ON) }),
  ciSummary: z.object({ enabled: z.boolean() }),
  persona: z.string(),
});

export const PolicyResponseSchema = z.object({
  ref: z.string(),
  /** `file` when `.mergemind.yml` exists and is valid; `default` otherwise. */
  source: z.enum(['file', 'default']),
  /** The raw file, or null when the repository has none. */
  text: z.string().nullable(),
  errors: z.array(z.string()),
  policy: EffectivePolicySchema,
});
export type PolicyResponse = z.infer<typeof PolicyResponseSchema>;

export const SnippetResponseSchema = z.object({
  path: z.string(),
  ref: ShaSchema,
  highlight: z.object({ start: z.number().int(), end: z.number().int() }),
  lines: z.array(z.object({ number: z.number().int().positive(), text: z.string() })),
});
export type SnippetResponse = z.infer<typeof SnippetResponseSchema>;

export const UsageResponseSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  usedTokens: z.number().int().nonnegative(),
  monthlyTokenBudget: z.number().int().nonnegative(),
  state: z.enum(['ok', 'warn', 'exhausted']),
  byKind: z.record(z.enum(USAGE_KINDS), z.number().int().nonnegative()),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

export const AcceptedResponseSchema = z.object({ jobId: z.string().min(1) });
export type AcceptedResponse = z.infer<typeof AcceptedResponseSchema>;

export const FindingStateResponseSchema = z.object({
  id: ObjectIdSchema,
  state: z.enum(FINDING_STATES),
});
export type FindingStateResponse = z.infer<typeof FindingStateResponseSchema>;
