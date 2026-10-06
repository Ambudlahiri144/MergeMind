import {
  FINDING_CATEGORIES,
  FINDING_STATES,
  REVIEW_PASSES,
  SEVERITIES,
  type FindingCategory,
  type FindingState,
  type ReviewPass,
  type Severity,
} from '@mergemind/shared';
import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

export const FINDING_PLACEMENTS = ['inline', 'summary'] as const;
export type FindingPlacement = (typeof FINDING_PLACEMENTS)[number];

export type FindingRecord = {
  reviewRunId: Types.ObjectId;
  pullRequestId: Types.ObjectId;
  repositoryId: Types.ObjectId;
  pass: ReviewPass;
  severity: Severity;
  confidence: number;
  category: FindingCategory;
  path: string;
  lineStart: number;
  lineEnd: number;
  title: string;
  body: string;
  suggestion?: string;
  fingerprint: string;
  state: FindingState;
  /** `inline` = posted as a review comment; `summary` = listed in the review body. */
  placement: FindingPlacement;
  githubCommentId?: number;
  /** Head SHA of the push that fixed it (incremental review, ADR-023). */
  resolvedInSha?: string;
  resolvedByRunId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

const findingSchema = new Schema<FindingRecord>(
  {
    reviewRunId: { type: Schema.Types.ObjectId, ref: 'ReviewRun', required: true },
    pullRequestId: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    pass: { type: String, enum: REVIEW_PASSES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    category: { type: String, enum: FINDING_CATEGORIES, required: true },
    path: { type: String, required: true },
    lineStart: { type: Number, required: true },
    lineEnd: { type: Number, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    suggestion: { type: String },
    fingerprint: { type: String, required: true },
    state: { type: String, enum: FINDING_STATES, required: true },
    placement: { type: String, enum: FINDING_PLACEMENTS, required: true },
    githubCommentId: { type: Number },
    resolvedInSha: { type: String },
    resolvedByRunId: { type: Schema.Types.ObjectId, ref: 'ReviewRun' },
  },
  { timestamps: true, collection: 'findings' },
);

findingSchema.index({ pullRequestId: 1, fingerprint: 1 }, { unique: true });
findingSchema.index({ reviewRunId: 1, severity: 1 });
// Open findings of a PR (resolution candidates, PR-wide gate).
findingSchema.index({ pullRequestId: 1, state: 1 });

export const FindingModel = defineModel('Finding', findingSchema);
