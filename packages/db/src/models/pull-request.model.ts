import { PULL_REQUEST_STATES, type PullRequestState } from '@mergemind/shared';
import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

export type PullRequestRecord = {
  repositoryId: Types.ObjectId;
  number: number;
  title: string;
  authorLogin: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  lastReviewedSha?: string;
  state: PullRequestState;
  isDraft: boolean;
  /** `pull_request.updated_at` of the newest event applied; guards against out-of-order delivery. */
  githubUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const pullRequestSchema = new Schema<PullRequestRecord>(
  {
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    number: { type: Number, required: true },
    title: { type: String, required: true },
    authorLogin: { type: String, required: true },
    baseRef: { type: String, required: true },
    headRef: { type: String, required: true },
    headSha: { type: String, required: true },
    lastReviewedSha: { type: String },
    state: { type: String, enum: PULL_REQUEST_STATES, required: true },
    isDraft: { type: Boolean, required: true },
    githubUpdatedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'pullRequests' },
);

pullRequestSchema.index({ repositoryId: 1, number: 1 }, { unique: true });
pullRequestSchema.index({ repositoryId: 1, state: 1, updatedAt: -1 });
// All PRs of a repository, newest first (the web's state=all list).
pullRequestSchema.index({ repositoryId: 1, updatedAt: -1 });
// Boot reconciliation on ephemeral hosts (ADR-038): open PRs by last GitHub update.
pullRequestSchema.index({ state: 1, githubUpdatedAt: -1 });

export const PullRequestModel = defineModel('PullRequest', pullRequestSchema);
