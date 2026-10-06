import type { LlmProviderName, UsageKind } from '@mergemind/shared';
import { Types } from 'mongoose';

import { UsageLedgerModel } from '../models/usage-ledger.model.js';

/** A run never makes more LLM calls than passes × MAX_CHUNKS_PER_RUN × providers × 2. */
export const MAX_USAGE_ROWS_PER_RUN = 500;

export type UsageRow = {
  installationId: string;
  repositoryId?: string;
  reviewRunId?: string;
  kind: UsageKind;
  provider: LlmProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  isFallback: boolean;
  period: string;
};

export type UsageLedgerRepository = {
  record(rows: readonly UsageRow[]): Promise<void>;
  /** Input + output tokens for the installation in a `YYYY-MM` period (budget check, F9). */
  sumTokensForPeriod(installationId: string, period: string): Promise<number>;
  /** The same total split by kind (review, embed, ci_summary) for the usage line. */
  sumTokensByKindForPeriod(
    installationId: string,
    period: string,
  ): Promise<Record<UsageKind, number>>;
  countForRun(reviewRunId: string): Promise<number>;
};

export function createUsageLedgerRepository(): UsageLedgerRepository {
  return {
    async record(rows) {
      if (rows.length === 0) {
        return;
      }
      await UsageLedgerModel.insertMany(
        rows
          .slice(0, MAX_USAGE_ROWS_PER_RUN)
          .map(({ installationId, repositoryId, reviewRunId, ...row }) => ({
            ...row,
            installationId: new Types.ObjectId(installationId),
            ...(repositoryId === undefined
              ? {}
              : { repositoryId: new Types.ObjectId(repositoryId) }),
            ...(reviewRunId === undefined ? {} : { reviewRunId: new Types.ObjectId(reviewRunId) }),
          })),
      );
    },

    async sumTokensForPeriod(installationId, period) {
      const [result] = await UsageLedgerModel.aggregate<{ total: number }>([
        { $match: { installationId: new Types.ObjectId(installationId), period } },
        { $group: { _id: null, total: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } } },
      ]);
      return result?.total ?? 0;
    },

    async sumTokensByKindForPeriod(installationId, period) {
      const rows = await UsageLedgerModel.aggregate<{ _id: UsageKind; total: number }>([
        { $match: { installationId: new Types.ObjectId(installationId), period } },
        {
          $group: { _id: '$kind', total: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } },
        },
      ]);
      const totals: Record<UsageKind, number> = { review: 0, embed: 0, ci_summary: 0 };
      for (const row of rows) {
        totals[row._id] = row.total;
      }
      return totals;
    },

    async countForRun(reviewRunId) {
      return UsageLedgerModel.countDocuments({ reviewRunId: new Types.ObjectId(reviewRunId) });
    },
  };
}
