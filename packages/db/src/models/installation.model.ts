import {
  ACCOUNT_TYPES,
  DEFAULT_ALLOWED_PROVIDERS,
  DEFAULT_MONTHLY_TOKEN_BUDGET,
  INSTALLATION_STATUSES,
  LLM_PROVIDER_NAMES,
  type AccountType,
  type InstallationStatus,
  type LlmProviderName,
} from '@mergemind/shared';
import { Schema } from 'mongoose';

import { defineModel } from './define-model.js';

export type InstallationRecord = {
  githubInstallationId: number;
  accountLogin: string;
  accountType: AccountType;
  status: InstallationStatus;
  monthlyTokenBudget: number;
  allowedProviders: LlmProviderName[];
  createdAt: Date;
  updatedAt: Date;
};

const installationSchema = new Schema<InstallationRecord>(
  {
    githubInstallationId: { type: Number, required: true },
    accountLogin: { type: String, required: true },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },
    status: { type: String, enum: INSTALLATION_STATUSES, required: true, default: 'active' },
    monthlyTokenBudget: { type: Number, required: true, default: DEFAULT_MONTHLY_TOKEN_BUDGET },
    allowedProviders: {
      type: [{ type: String, enum: LLM_PROVIDER_NAMES }],
      default: () => [...DEFAULT_ALLOWED_PROVIDERS],
    },
  },
  { timestamps: true, collection: 'installations' },
);

installationSchema.index({ githubInstallationId: 1 }, { unique: true });

export const InstallationModel = defineModel('Installation', installationSchema);
