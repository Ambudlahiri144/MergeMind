import { Types } from 'mongoose';

import { SuppressionModel } from '../models/suppression.model.js';

export type SuppressionsRepository = {
  /** Which of these fingerprints are suppressed in the repo (PRD F8). */
  findSuppressed(repositoryId: string, fingerprints: readonly string[]): Promise<Set<string>>;
  /** Idempotent: suppressing the same fingerprint twice keeps the first record. */
  suppress(input: {
    repositoryId: string;
    fingerprint: string;
    createdByLogin: string;
    reason?: string;
  }): Promise<void>;
};

export function createSuppressionsRepository(): SuppressionsRepository {
  return {
    async findSuppressed(repositoryId, fingerprints) {
      if (fingerprints.length === 0) {
        return new Set();
      }
      const docs = await SuppressionModel.find(
        { repositoryId: new Types.ObjectId(repositoryId), fingerprint: { $in: fingerprints } },
        { fingerprint: 1, _id: 0 },
      )
        .limit(fingerprints.length)
        .lean();
      return new Set(docs.map((doc) => doc.fingerprint));
    },

    async suppress({ repositoryId, fingerprint, createdByLogin, reason }) {
      await SuppressionModel.updateOne(
        { repositoryId: new Types.ObjectId(repositoryId), fingerprint },
        { $setOnInsert: { createdByLogin, ...(reason === undefined ? {} : { reason }) } },
        { upsert: true },
      );
    },
  };
}
