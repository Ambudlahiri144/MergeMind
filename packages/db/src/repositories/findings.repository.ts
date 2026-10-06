import type { FindingCategory, FindingState, ReviewPass, Severity } from '@mergemind/shared';
import { Types, type AnyBulkWriteOperation } from 'mongoose';

import {
  FindingModel,
  type FindingPlacement,
  type FindingRecord,
} from '../models/finding.model.js';

export type { FindingPlacement } from '../models/finding.model.js';

/** Upper bound on findings stored per run: passes × chunks × MAX_FINDINGS_PER_PASS, capped. */
export const MAX_FINDINGS_PER_RUN = 500;

export type NewFinding = {
  pass: ReviewPass;
  severity: Severity;
  confidence: number;
  category: FindingCategory;
  path: string;
  lineStart: number;
  lineEnd: number;
  title: string;
  body: string;
  suggestion: string | null;
  fingerprint: string;
  state: FindingState;
  placement: FindingPlacement;
};

export type FindingView = NewFinding & {
  id: string;
  reviewRunId: string;
  githubCommentId?: number;
};

export type RunScope = {
  reviewRunId: string;
  pullRequestId: string;
  repositoryId: string;
};

export type FindingsRepository = {
  /** Which of these fingerprints this PR already has, from any run (never post twice, F5). */
  findExistingFingerprints(
    pullRequestId: string,
    fingerprints: readonly string[],
  ): Promise<Set<string>>;
  /** Inserts the run's findings; a fingerprint that raced in from another run is skipped. */
  insertForRun(scope: RunScope, findings: readonly NewFinding[]): Promise<number>;
  listForRun(reviewRunId: string): Promise<FindingView[]>;
  setCommentIds(
    reviewRunId: string,
    comments: readonly { fingerprint: string; githubCommentId: number }[],
  ): Promise<void>;
  /** Open findings of the PR from runs other than `excludeRunId` (resolution candidates). */
  listOpenForPr(pullRequestId: string, excludeRunId: string): Promise<FindingView[]>;
  /** Marks findings fixed by a push; only still-open ones change (idempotent, ADR-023). */
  markResolved(
    findingIds: readonly string[],
    resolution: { sha: string; runId: string },
  ): Promise<number>;
  listResolvedByRun(reviewRunId: string): Promise<FindingView[]>;
  /** Open findings on the PR by severity: the PR-wide gate input (ADR-023). */
  countOpenBySeverity(
    pullRequestId: string,
  ): Promise<{ critical: number; major: number; minor: number }>;
  findById(findingId: string): Promise<(FindingView & FindingScope) | null>;
  /** Open -> dismissed (PRD F8); false when it was not open (already dismissed or resolved). */
  dismiss(findingId: string): Promise<boolean>;
};

export type FindingScope = { pullRequestId: string; repositoryId: string };

type LeanFinding = FindingRecord & { _id: Types.ObjectId };

function toView(doc: LeanFinding): FindingView {
  return {
    id: doc._id.toString(),
    reviewRunId: doc.reviewRunId.toString(),
    pass: doc.pass,
    severity: doc.severity,
    confidence: doc.confidence,
    category: doc.category,
    path: doc.path,
    lineStart: doc.lineStart,
    lineEnd: doc.lineEnd,
    title: doc.title,
    body: doc.body,
    suggestion: doc.suggestion ?? null,
    fingerprint: doc.fingerprint,
    state: doc.state,
    placement: doc.placement,
    ...(doc.githubCommentId === undefined ? {} : { githubCommentId: doc.githubCommentId }),
  };
}

export function createFindingsRepository(): FindingsRepository {
  return {
    async findExistingFingerprints(pullRequestId, fingerprints) {
      if (fingerprints.length === 0) {
        return new Set();
      }
      const docs = await FindingModel.find(
        { pullRequestId: new Types.ObjectId(pullRequestId), fingerprint: { $in: fingerprints } },
        { fingerprint: 1, _id: 0 },
      )
        .limit(fingerprints.length)
        .lean();
      return new Set(docs.map((doc) => doc.fingerprint));
    },

    async insertForRun(scope, findings) {
      if (findings.length === 0) {
        return 0;
      }
      const ids = {
        reviewRunId: new Types.ObjectId(scope.reviewRunId),
        pullRequestId: new Types.ObjectId(scope.pullRequestId),
        repositoryId: new Types.ObjectId(scope.repositoryId),
      };
      // Upsert on the unique (pullRequestId, fingerprint) key: a row that already exists (an
      // earlier run, or a retry of this one) is left untouched, so this never throws E11000.
      const operations: AnyBulkWriteOperation<FindingRecord>[] = findings
        .slice(0, MAX_FINDINGS_PER_RUN)
        .map(({ suggestion, fingerprint, ...finding }) => ({
          updateOne: {
            filter: { pullRequestId: ids.pullRequestId, fingerprint },
            update: {
              $setOnInsert: {
                ...finding,
                reviewRunId: ids.reviewRunId,
                repositoryId: ids.repositoryId,
                ...(suggestion === null ? {} : { suggestion }),
              },
            },
            upsert: true,
          },
        }));
      const result = await FindingModel.bulkWrite(operations, { ordered: false });
      return result.upsertedCount;
    },

    async listForRun(reviewRunId) {
      const docs = await FindingModel.find(
        { reviewRunId: new Types.ObjectId(reviewRunId) },
        { createdAt: 0, updatedAt: 0, __v: 0 },
      )
        .limit(MAX_FINDINGS_PER_RUN)
        .lean<LeanFinding[]>();
      return docs.map(toView);
    },

    async setCommentIds(reviewRunId, comments) {
      if (comments.length === 0) {
        return;
      }
      const runId = new Types.ObjectId(reviewRunId);
      const operations: AnyBulkWriteOperation<FindingRecord>[] = comments.map((comment) => ({
        updateOne: {
          filter: { reviewRunId: runId, fingerprint: comment.fingerprint },
          update: { $set: { githubCommentId: comment.githubCommentId } },
        },
      }));
      await FindingModel.bulkWrite(operations, { ordered: false });
    },

    async listOpenForPr(pullRequestId, excludeRunId) {
      const docs = await FindingModel.find(
        {
          pullRequestId: new Types.ObjectId(pullRequestId),
          state: 'open',
          reviewRunId: { $ne: new Types.ObjectId(excludeRunId) },
        },
        { createdAt: 0, updatedAt: 0, __v: 0 },
      )
        .limit(MAX_FINDINGS_PER_RUN)
        .lean<LeanFinding[]>();
      return docs.map(toView);
    },

    async markResolved(findingIds, { sha, runId }) {
      if (findingIds.length === 0) {
        return 0;
      }
      const result = await FindingModel.updateMany(
        { _id: { $in: findingIds.map((id) => new Types.ObjectId(id)) }, state: 'open' },
        {
          $set: {
            state: 'resolved',
            resolvedInSha: sha,
            resolvedByRunId: new Types.ObjectId(runId),
          },
        },
      );
      return result.modifiedCount;
    },

    async listResolvedByRun(reviewRunId) {
      const docs = await FindingModel.find(
        { resolvedByRunId: new Types.ObjectId(reviewRunId), state: 'resolved' },
        { createdAt: 0, updatedAt: 0, __v: 0 },
      )
        .limit(MAX_FINDINGS_PER_RUN)
        .lean<LeanFinding[]>();
      return docs.map(toView);
    },

    async countOpenBySeverity(pullRequestId) {
      const rows = await FindingModel.aggregate<{ _id: Severity; count: number }>([
        { $match: { pullRequestId: new Types.ObjectId(pullRequestId), state: 'open' } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]);
      const counts = { critical: 0, major: 0, minor: 0 };
      for (const row of rows) {
        counts[row._id] = row.count;
      }
      return counts;
    },

    async findById(findingId) {
      const doc = await FindingModel.findOne(
        { _id: new Types.ObjectId(findingId) },
        { createdAt: 0, updatedAt: 0, __v: 0 },
      ).lean<LeanFinding>();
      if (!doc) {
        return null;
      }
      return {
        ...toView(doc),
        pullRequestId: doc.pullRequestId.toString(),
        repositoryId: doc.repositoryId.toString(),
      };
    },

    async dismiss(findingId) {
      const result = await FindingModel.updateOne(
        { _id: new Types.ObjectId(findingId), state: 'open' },
        { $set: { state: 'dismissed' } },
      );
      return result.modifiedCount > 0;
    },
  };
}
