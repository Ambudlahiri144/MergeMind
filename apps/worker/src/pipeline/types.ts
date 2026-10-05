import type {
  FindingsRepository,
  InstallationsRepository,
  PullRequestsRepository,
  RepositoriesRepository,
  ReviewRunsRepository,
  SuppressionsRepository,
  UsageLedgerRepository,
} from '@mergemind/db';
import type { GithubApp } from '@mergemind/github';
import type { ReviewLlm } from '@mergemind/llm';
import type { GateConclusion, ReviewRunMode, SkipReason } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';

export type ReviewPipelineConfig = {
  /** Estimated tokens of diff per LLM call (`LLM_CHUNK_TOKENS`). */
  chunkTokens: number;
  /** Concurrent LLM calls per run (`LLM_PASS_CONCURRENCY`). */
  passConcurrency: number;
  maxInlineComments: number;
  /** More chunks than this switches the run to summary_only. */
  maxChunksPerRun: number;
};

export const DEFAULT_PIPELINE_CONFIG: ReviewPipelineConfig = {
  chunkTokens: 6000,
  passConcurrency: 3,
  maxInlineComments: 25,
  maxChunksPerRun: 12,
};

/** Everything the pipeline touches, injected so tests run it without module mocks. */
export type ReviewDeps = {
  installations: InstallationsRepository;
  repositories: RepositoriesRepository;
  pullRequests: PullRequestsRepository;
  reviewRuns: ReviewRunsRepository;
  findings: FindingsRepository;
  suppressions: SuppressionsRepository;
  usageLedger: UsageLedgerRepository;
  github: GithubApp;
  llm: ReviewLlm;
  logger: Logger;
  now: () => Date;
  config: ReviewPipelineConfig;
};

export type ReviewJobMeta = {
  jobId: string;
  /** Epoch ms when the job was enqueued (`job.timestamp`). */
  enqueuedAt: number;
  /** True on the last BullMQ attempt: failures then close the check run instead of retrying. */
  isFinalAttempt: boolean;
};

export type ReviewOutcome = {
  runId: string | null;
  status: 'completed' | 'replayed' | 'skipped';
  mode: ReviewRunMode;
  gateConclusion?: GateConclusion;
  skipReason?: SkipReason;
};

/** All providers failed on a non-final attempt; BullMQ retries the job with backoff. */
export class ReviewRetryableError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'ReviewRetryableError';
  }
}
