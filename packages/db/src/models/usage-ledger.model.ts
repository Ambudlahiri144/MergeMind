import {
  LLM_PROVIDER_NAMES,
  USAGE_KINDS,
  type LlmProviderName,
  type UsageKind,
} from '@mergemind/shared';
import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

/** One row per LLM call (PRD F9, "100% of LLM calls recorded"). */
export type UsageLedgerRecord = {
  installationId: Types.ObjectId;
  repositoryId?: Types.ObjectId;
  reviewRunId?: Types.ObjectId;
  kind: UsageKind;
  provider: LlmProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  isFallback: boolean;
  /** `YYYY-MM` in UTC (`usagePeriod`), the budget window. */
  period: string;
  createdAt: Date;
  updatedAt: Date;
};

const usageLedgerSchema = new Schema<UsageLedgerRecord>(
  {
    installationId: { type: Schema.Types.ObjectId, ref: 'Installation', required: true },
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository' },
    reviewRunId: { type: Schema.Types.ObjectId, ref: 'ReviewRun' },
    kind: { type: String, enum: USAGE_KINDS, required: true },
    provider: { type: String, enum: LLM_PROVIDER_NAMES, required: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, required: true, min: 0 },
    outputTokens: { type: Number, required: true, min: 0 },
    latencyMs: { type: Number, required: true, min: 0 },
    isFallback: { type: Boolean, required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  },
  { timestamps: true, collection: 'usageLedger' },
);

usageLedgerSchema.index({ installationId: 1, period: 1 });
usageLedgerSchema.index({ reviewRunId: 1 });

export const UsageLedgerModel = defineModel('UsageLedger', usageLedgerSchema);
