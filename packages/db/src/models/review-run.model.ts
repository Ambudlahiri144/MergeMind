import {
  GATE_CONCLUSIONS,
  REVIEW_PASSES,
  REVIEW_RUN_MODES,
  REVIEW_RUN_STATUSES,
  REVIEW_TRIGGERS,
  SKIP_REASONS,
  type GateConclusion,
  type ReviewPass,
  type ReviewRunMode,
  type ReviewRunStatus,
  type ReviewTrigger,
  type SkipReason,
} from '@mergemind/shared';
import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

export type RunCounts = {
  critical: number;
  major: number;
  minor: number;
  suppressed: number;
  filtered: number;
  /** Findings already reported on this PR by an earlier run (never posted twice). */
  duplicate: number;
  /** Restatements of a kept finding from another pass, folded into it (ADR-021). */
  merged: number;
};

export type RunTokens = { input: number; output: number };

export type RunTimings = {
  queuedMs: number;
  fetchMs: number;
  retrieveMs: number;
  llmMs: number;
  publishMs: number;
  totalMs: number;
};

export type ReviewRunRecord = {
  pullRequestId: Types.ObjectId;
  repositoryId: Types.ObjectId;
  headSha: string;
  baseSha: string;
  trigger: ReviewTrigger;
  mode: ReviewRunMode;
  status: ReviewRunStatus;
  skipReason?: SkipReason;
  checkRunId?: number;
  /** Set once the PR review is posted; with the body marker it prevents a second post (ADR-018). */
  githubReviewId?: number;
  gateConclusion?: GateConclusion;
  counts: RunCounts;
  tokens: RunTokens;
  timings: RunTimings;
  promptVersion: string;
  attempt: number;
  /** Set when findings are persisted; a retried job then skips the LLM passes (ADR-018). */
  analyzedAt?: Date;
  isBudgetWarning: boolean;
  policyErrors: string[];
  failedPasses: ReviewPass[];
  error?: { code: string; message: string };
  createdAt: Date;
  updatedAt: Date;
};

export const EMPTY_COUNTS: RunCounts = {
  critical: 0,
  major: 0,
  minor: 0,
  suppressed: 0,
  filtered: 0,
  duplicate: 0,
  merged: 0,
};
export const EMPTY_TIMINGS: RunTimings = {
  queuedMs: 0,
  fetchMs: 0,
  retrieveMs: 0,
  llmMs: 0,
  publishMs: 0,
  totalMs: 0,
};

const countsSchema = new Schema<RunCounts>(
  {
    critical: { type: Number, required: true },
    major: { type: Number, required: true },
    minor: { type: Number, required: true },
    suppressed: { type: Number, required: true },
    filtered: { type: Number, required: true },
    duplicate: { type: Number, required: true },
    merged: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const timingsSchema = new Schema<RunTimings>(
  {
    queuedMs: { type: Number, required: true },
    fetchMs: { type: Number, required: true },
    retrieveMs: { type: Number, required: true },
    llmMs: { type: Number, required: true },
    publishMs: { type: Number, required: true },
    totalMs: { type: Number, required: true },
  },
  { _id: false },
);

const reviewRunSchema = new Schema<ReviewRunRecord>(
  {
    pullRequestId: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    headSha: { type: String, required: true },
    baseSha: { type: String, required: true },
    trigger: { type: String, enum: REVIEW_TRIGGERS, required: true },
    mode: { type: String, enum: REVIEW_RUN_MODES, required: true },
    status: { type: String, enum: REVIEW_RUN_STATUSES, required: true },
    skipReason: { type: String, enum: SKIP_REASONS },
    checkRunId: { type: Number },
    githubReviewId: { type: Number },
    gateConclusion: { type: String, enum: GATE_CONCLUSIONS },
    counts: { type: countsSchema, required: true, default: () => ({ ...EMPTY_COUNTS }) },
    tokens: {
      type: new Schema<RunTokens>(
        { input: { type: Number, required: true }, output: { type: Number, required: true } },
        { _id: false },
      ),
      required: true,
      default: () => ({ input: 0, output: 0 }),
    },
    timings: { type: timingsSchema, required: true, default: () => ({ ...EMPTY_TIMINGS }) },
    promptVersion: { type: String, required: true },
    attempt: { type: Number, required: true, default: 1 },
    analyzedAt: { type: Date },
    isBudgetWarning: { type: Boolean, required: true, default: false },
    policyErrors: { type: [String], default: [] },
    failedPasses: { type: [{ type: String, enum: REVIEW_PASSES }], default: [] },
    error: {
      type: new Schema(
        { code: { type: String, required: true }, message: { type: String, required: true } },
        { _id: false },
      ),
    },
  },
  { timestamps: true, collection: 'reviewRuns' },
);

reviewRunSchema.index({ pullRequestId: 1, createdAt: -1 });
reviewRunSchema.index({ repositoryId: 1, headSha: 1, attempt: 1 }, { unique: true });
reviewRunSchema.index({ status: 1, updatedAt: 1 });

export const ReviewRunModel = defineModel('ReviewRun', reviewRunSchema);
