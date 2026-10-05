/** Prefix for problem+json `type` URIs (Architecture.md §5). */
export const PROBLEM_TYPE_BASE_URL = 'https://mergemind.dev/errors';

export const API_BASE_PATH = '/api/v1';
export const WEBHOOK_PATH = '/webhooks/github';
export const REQUEST_ID_HEADER = 'x-request-id';

/** BullMQ queue names (rules.md §1: lowercase noun). */
export const QUEUE_NAMES = {
  review: 'review',
  index: 'index',
  ciSummary: 'ci-summary',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** BullMQ job names (rules.md §1: `<queue>.<object>`). */
export const JOB_NAMES = {
  reviewPr: 'review.pr',
  indexRepo: 'index.repo',
  ciSummaryRun: 'ci-summary.run',
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export const LLM_PROVIDER_NAMES = ['groq', 'gemini', 'ollama'] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

/** Default for `installations.allowedProviders`: Gemini free tier is excluded (ADR-007). */
export const DEFAULT_ALLOWED_PROVIDERS: readonly LlmProviderName[] = ['groq', 'ollama'];
