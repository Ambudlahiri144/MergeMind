import type {
  GateConclusion,
  ReviewPass,
  ReviewRunMode,
  ReviewRunStatus,
  ReviewTrigger,
  SkipReason,
} from '@mergemind/shared';
import { Types } from 'mongoose';

import {
  EMPTY_COUNTS,
  EMPTY_TIMINGS,
  ReviewRunModel,
  type ReviewRunRecord,
  type RunCounts,
  type RunTimings,
  type RunTokens,
} from '../models/review-run.model.js';

export type { RunCounts, RunTimings, RunTokens } from '../models/review-run.model.js';
export { EMPTY_COUNTS as EMPTY_REVIEW_COUNTS } from '../models/review-run.model.js';

export type StartRunInput = {
  repositoryId: string;
  pullRequestId: string;
  headSha: string;
  baseSha: string;
  trigger: ReviewTrigger;
  attempt: number;
  promptVersion: string;
};

export type ReviewRunView = {
  id: string;
  repositoryId: string;
  pullRequestId: string;
  headSha: string;
  baseSha: string;
  trigger: ReviewTrigger;
  mode: ReviewRunMode;
  status: ReviewRunStatus;
  skipReason?: SkipReason;
  checkRunId?: number;
  githubReviewId?: number;
  gateConclusion?: GateConclusion;
  counts: RunCounts;
  tokens: RunTokens;
  timings: RunTimings;
  promptVersion: string;
  attempt: number;
  analyzedAt?: Date;
  isBudgetWarning: boolean;
  policyErrors: string[];
  failedPasses: ReviewPass[];
  error?: { code: string; message: string };
};

export type AnalyzedPatch = {
  mode: ReviewRunMode;
  tokens: RunTokens;
  counts: RunCounts;
  failedPasses: ReviewPass[];
};

export type CompleteRunPatch = {
  mode: ReviewRunMode;
  gateConclusion: GateConclusion;
  counts: RunCounts;
  timings: RunTimings;
  isBudgetWarning: boolean;
  policyErrors: string[];
  skipReason?: SkipReason;
};

export type ReviewRunsRepository = {
  /**
   * Creates the run for (repository, headSha, attempt) or returns the existing one, so a retried
   * or replayed job resumes instead of starting over (ADR-018).
   */
  startOrResume(input: StartRunInput): Promise<{ run: ReviewRunView; isNew: boolean }>;
  setCheckRunId(runId: string, checkRunId: number): Promise<void>;
  setGithubReviewId(runId: string, githubReviewId: number): Promise<void>;
  markAnalyzed(runId: string, patch: AnalyzedPatch, analyzedAt: Date): Promise<void>;
  complete(runId: string, patch: CompleteRunPatch): Promise<void>;
  fail(runId: string, error: { code: string; message: string }): Promise<void>;
  findById(runId: string): Promise<ReviewRunView | null>;
};

type LeanRun = ReviewRunRecord & { _id: Types.ObjectId };

function toView(doc: LeanRun): ReviewRunView {
  return {
    id: doc._id.toString(),
    repositoryId: doc.repositoryId.toString(),
    pullRequestId: doc.pullRequestId.toString(),
    headSha: doc.headSha,
    baseSha: doc.baseSha,
    trigger: doc.trigger,
    mode: doc.mode,
    status: doc.status,
    counts: doc.counts,
    tokens: doc.tokens,
    timings: doc.timings,
    promptVersion: doc.promptVersion,
    attempt: doc.attempt,
    isBudgetWarning: doc.isBudgetWarning,
    policyErrors: doc.policyErrors,
    failedPasses: doc.failedPasses,
    ...(doc.skipReason === undefined ? {} : { skipReason: doc.skipReason }),
    ...(doc.checkRunId === undefined ? {} : { checkRunId: doc.checkRunId }),
    ...(doc.githubReviewId === undefined ? {} : { githubReviewId: doc.githubReviewId }),
    ...(doc.gateConclusion === undefined ? {} : { gateConclusion: doc.gateConclusion }),
    ...(doc.analyzedAt === undefined ? {} : { analyzedAt: doc.analyzedAt }),
    ...(doc.error === undefined ? {} : { error: doc.error }),
  };
}

const RUN_PROJECTION = { createdAt: 0, updatedAt: 0, __v: 0 } as const;

export function createReviewRunsRepository(): ReviewRunsRepository {
  const byId = (runId: string) => ({ _id: new Types.ObjectId(runId) });

  return {
    async startOrResume(input) {
      const filter = {
        repositoryId: new Types.ObjectId(input.repositoryId),
        headSha: input.headSha,
        attempt: input.attempt,
      };
      const result = await ReviewRunModel.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            pullRequestId: new Types.ObjectId(input.pullRequestId),
            baseSha: input.baseSha,
            trigger: input.trigger,
            promptVersion: input.promptVersion,
            mode: 'full',
            status: 'running',
            counts: { ...EMPTY_COUNTS },
            tokens: { input: 0, output: 0 },
            timings: { ...EMPTY_TIMINGS },
            isBudgetWarning: false,
            policyErrors: [],
            failedPasses: [],
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          includeResultMetadata: true,
          projection: RUN_PROJECTION,
        },
      ).lean<{ value: LeanRun | null; lastErrorObject?: { updatedExisting?: boolean } }>();
      if (!result.value) {
        throw new Error(`Upsert returned no review run for ${input.headSha}`);
      }
      return {
        run: toView(result.value),
        isNew: result.lastErrorObject?.updatedExisting !== true,
      };
    },

    async setCheckRunId(runId, checkRunId) {
      await ReviewRunModel.updateOne(byId(runId), { $set: { checkRunId } });
    },

    async setGithubReviewId(runId, githubReviewId) {
      await ReviewRunModel.updateOne(byId(runId), { $set: { githubReviewId } });
    },

    async markAnalyzed(runId, patch, analyzedAt) {
      await ReviewRunModel.updateOne(byId(runId), { $set: { ...patch, analyzedAt } });
    },

    async complete(runId, patch) {
      await ReviewRunModel.updateOne(byId(runId), {
        $set: { ...patch, status: 'completed' },
        $unset: { error: 1 },
      });
    },

    async fail(runId, error) {
      await ReviewRunModel.updateOne(byId(runId), { $set: { status: 'failed', error } });
    },

    async findById(runId) {
      const doc = await ReviewRunModel.findOne(byId(runId), RUN_PROJECTION).lean<LeanRun>();
      return doc ? toView(doc) : null;
    },
  };
}
