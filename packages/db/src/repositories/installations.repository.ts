import type { AccountType, InstallationStatus, LlmProviderName } from '@mergemind/shared';

import { InstallationModel } from '../models/installation.model.js';

export type UpsertInstallationInput = {
  githubInstallationId: number;
  accountLogin: string;
  accountType: AccountType;
  status: InstallationStatus;
};

export type InstallationView = {
  id: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: AccountType;
  status: InstallationStatus;
  monthlyTokenBudget: number;
  allowedProviders: LlmProviderName[];
};

export type InstallationsRepository = {
  /** Creates or updates by GitHub id and returns our id. Budget and allowlist keep their values. */
  upsertFromGithub(input: UpsertInstallationInput): Promise<string>;
  findIdByGithubId(githubInstallationId: number): Promise<string | null>;
  findByGithubId(githubInstallationId: number): Promise<InstallationView | null>;
};

export function createInstallationsRepository(): InstallationsRepository {
  return {
    async upsertFromGithub({ githubInstallationId, accountLogin, accountType, status }) {
      const doc = await InstallationModel.findOneAndUpdate(
        { githubInstallationId },
        { $set: { accountLogin, accountType, status } },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
          projection: { _id: 1 },
        },
      ).lean();
      if (!doc) {
        throw new Error(`Upsert returned no installation for ${githubInstallationId}`);
      }
      return doc._id.toString();
    },

    async findIdByGithubId(githubInstallationId) {
      const doc = await InstallationModel.findOne({ githubInstallationId }, { _id: 1 }).lean();
      return doc ? doc._id.toString() : null;
    },

    async findByGithubId(githubInstallationId) {
      const doc = await InstallationModel.findOne(
        { githubInstallationId },
        {
          githubInstallationId: 1,
          accountLogin: 1,
          accountType: 1,
          status: 1,
          monthlyTokenBudget: 1,
          allowedProviders: 1,
        },
      ).lean();
      if (!doc) {
        return null;
      }
      return {
        id: doc._id.toString(),
        githubInstallationId: doc.githubInstallationId,
        accountLogin: doc.accountLogin,
        accountType: doc.accountType,
        status: doc.status,
        monthlyTokenBudget: doc.monthlyTokenBudget,
        allowedProviders: doc.allowedProviders,
      };
    },
  };
}
