import type { PullRequestState } from '@mergemind/shared';
import { Types } from 'mongoose';

import { isDuplicateKeyError } from '../models/define-model.js';
import { PullRequestModel, type PullRequestRecord } from '../models/pull-request.model.js';

export type PullRequestInput = {
  repositoryId: string;
  number: number;
  title: string;
  authorLogin: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  state: PullRequestState;
  isDraft: boolean;
  githubUpdatedAt: Date;
};

export type PullRequestView = Omit<PullRequestInput, 'repositoryId'> & {
  id: string;
  repositoryId: string;
  /** Head SHA of the last completed review: the base of an incremental review (F5). */
  lastReviewedSha?: string;
  updatedAt: Date;
};

export type PullRequestsRepository = {
  /**
   * Applies the snapshot only if it is at least as new as the stored one, so a late
   * redelivery can never roll `headSha` or `state` back. `isApplied` is false for stale input.
   */
  upsertIfNewer(input: PullRequestInput): Promise<{ isApplied: boolean }>;
  findByNumber(repositoryId: string, number: number): Promise<PullRequestView | null>;
  /** Records the head SHA a completed review covered (incremental review base, Phase 4). */
  setLastReviewedSha(repositoryId: string, number: number, sha: string): Promise<void>;
  findById(pullRequestId: string): Promise<PullRequestView | null>;
  /** One page of a repository's PRs, newest update first; `before` is the previous page's last row. */
  listForRepository(
    repositoryId: string,
    page: { state?: PullRequestState; limit: number; before?: { updatedAt: Date; id: string } },
  ): Promise<PullRequestView[]>;
  /** Open PR count per repository id (repository list). */
  countOpenByRepository(repositoryIds: readonly string[]): Promise<Map<string, number>>;
  /** Open PRs across repositories updated on GitHub since `since`, newest first (ADR-038). */
  listOpenUpdatedSince(since: Date, limit: number): Promise<PullRequestView[]>;
};

const VIEW_PROJECTION = {
  number: 1,
  repositoryId: 1,
  title: 1,
  authorLogin: 1,
  baseRef: 1,
  headRef: 1,
  headSha: 1,
  state: 1,
  isDraft: 1,
  githubUpdatedAt: 1,
  lastReviewedSha: 1,
  updatedAt: 1,
} as const;

type LeanPullRequest = PullRequestRecord & { _id: Types.ObjectId };

function toView(doc: LeanPullRequest): PullRequestView {
  return {
    id: doc._id.toString(),
    repositoryId: doc.repositoryId.toString(),
    number: doc.number,
    title: doc.title,
    authorLogin: doc.authorLogin,
    baseRef: doc.baseRef,
    headRef: doc.headRef,
    headSha: doc.headSha,
    state: doc.state,
    isDraft: doc.isDraft,
    githubUpdatedAt: doc.githubUpdatedAt,
    updatedAt: doc.updatedAt,
    ...(doc.lastReviewedSha === undefined ? {} : { lastReviewedSha: doc.lastReviewedSha }),
  };
}

export function createPullRequestsRepository(): PullRequestsRepository {
  return {
    async upsertIfNewer({ repositoryId, number, githubUpdatedAt, ...fields }) {
      try {
        const result = await PullRequestModel.updateOne(
          {
            repositoryId: new Types.ObjectId(repositoryId),
            number,
            githubUpdatedAt: { $lte: githubUpdatedAt },
          },
          { $set: { ...fields, githubUpdatedAt } },
          { upsert: true },
        );
        return { isApplied: result.matchedCount > 0 || result.upsertedCount > 0 };
      } catch (error) {
        // The row exists but is newer: the filter missed, the upsert collided on the unique key.
        if (isDuplicateKeyError(error)) {
          return { isApplied: false };
        }
        throw error;
      }
    },

    async findByNumber(repositoryId, number) {
      const doc = await PullRequestModel.findOne(
        { repositoryId: new Types.ObjectId(repositoryId), number },
        VIEW_PROJECTION,
      ).lean<LeanPullRequest>();
      return doc ? toView(doc) : null;
    },

    async findById(pullRequestId) {
      const doc = await PullRequestModel.findOne(
        { _id: new Types.ObjectId(pullRequestId) },
        VIEW_PROJECTION,
      ).lean<LeanPullRequest>();
      return doc ? toView(doc) : null;
    },

    async listOpenUpdatedSince(since, limit) {
      const docs = await PullRequestModel.find(
        { state: 'open', githubUpdatedAt: { $gte: since } },
        VIEW_PROJECTION,
      )
        .sort({ githubUpdatedAt: -1 })
        .limit(limit)
        .lean<LeanPullRequest[]>();
      return docs.map(toView);
    },

    async listForRepository(repositoryId, { state, limit, before }) {
      const filter = {
        repositoryId: new Types.ObjectId(repositoryId),
        ...(state === undefined ? {} : { state }),
        ...(before === undefined
          ? {}
          : {
              $or: [
                { updatedAt: { $lt: before.updatedAt } },
                { updatedAt: before.updatedAt, _id: { $lt: new Types.ObjectId(before.id) } },
              ],
            }),
      };
      const docs = await PullRequestModel.find(filter, VIEW_PROJECTION)
        .sort({ updatedAt: -1, _id: -1 })
        .limit(limit)
        .lean<LeanPullRequest[]>();
      return docs.map(toView);
    },

    async countOpenByRepository(repositoryIds) {
      if (repositoryIds.length === 0) {
        return new Map();
      }
      const rows = await PullRequestModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            repositoryId: { $in: repositoryIds.map((id) => new Types.ObjectId(id)) },
            state: 'open',
          },
        },
        { $group: { _id: '$repositoryId', count: { $sum: 1 } } },
      ]);
      return new Map(rows.map((row) => [row._id.toString(), row.count]));
    },

    async setLastReviewedSha(repositoryId, number, sha) {
      await PullRequestModel.updateOne(
        { repositoryId: new Types.ObjectId(repositoryId), number },
        { $set: { lastReviewedSha: sha } },
      );
    },
  };
}
