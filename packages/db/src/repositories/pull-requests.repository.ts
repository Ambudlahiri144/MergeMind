import type { PullRequestState } from '@mergemind/shared';
import { Types } from 'mongoose';

import { isDuplicateKeyError } from '../models/define-model.js';
import { PullRequestModel } from '../models/pull-request.model.js';

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
};

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
        {
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
        },
      ).lean();
      if (!doc) {
        return null;
      }
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
      };
    },

    async setLastReviewedSha(repositoryId, number, sha) {
      await PullRequestModel.updateOne(
        { repositoryId: new Types.ObjectId(repositoryId), number },
        { $set: { lastReviewedSha: sha } },
      );
    },
  };
}
