// Domain enums from Architecture.md §4, as `as const` tuples (rules.md §2: no `enum`).

export const ACCOUNT_TYPES = ['Organization', 'User'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const INSTALLATION_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export const INDEX_STATUSES = ['none', 'indexing', 'ready', 'failed'] as const;
export type IndexStatus = (typeof INDEX_STATUSES)[number];

export const PULL_REQUEST_STATES = ['open', 'closed', 'merged'] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export const REVIEW_TRIGGERS = [
  'opened',
  'synchronize',
  'reopened',
  'ready_for_review',
  'manual',
] as const;
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number];

/**
 * `handled` means the api processed the event inline (installation sync, PR closed);
 * `enqueued` means a job carries the real work (Architecture.md §3: outbox-style log).
 */
export const WEBHOOK_DELIVERY_STATUSES = [
  'received',
  'enqueued',
  'handled',
  'ignored',
  'failed',
] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;

export const REVIEW_PASSES = ['security', 'correctness', 'maintainability'] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

export const SEVERITIES = ['critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_STATES = ['open', 'resolved', 'dismissed', 'filtered'] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export const REVIEW_RUN_MODES = ['full', 'incremental', 'summary_only', 'skipped'] as const;
export type ReviewRunMode = (typeof REVIEW_RUN_MODES)[number];

export const REVIEW_RUN_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type ReviewRunStatus = (typeof REVIEW_RUN_STATUSES)[number];

export const GATE_CONCLUSIONS = ['success', 'failure', 'neutral'] as const;
export type GateConclusion = (typeof GATE_CONCLUSIONS)[number];

export const USAGE_KINDS = ['review', 'embed', 'ci_summary'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** Why a run did not review anything (Architecture.md §4 `reviewRuns.skipReason`). */
export const SKIP_REASONS = [
  'disabled',
  'not_installed',
  'installation_inactive',
  'policy_disabled',
  'draft',
  'superseded',
  'budget_exhausted',
  'no_reviewable_changes',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
