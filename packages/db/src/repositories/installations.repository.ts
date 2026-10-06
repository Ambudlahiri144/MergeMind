import type { AccountType, InstallationStatus, LlmProviderName } from '@mergemind/shared';
import { Types } from 'mongoose';

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
  findById(installationId: string): Promise<InstallationView | null>;
  /** Active installations, oldest first, bounded (access resolution, ADR-030). */
  listActive(limit: number): Promise<InstallationView[]>;
  setBudget(installationId: string, monthlyTokenBudget: number): Promise<void>;
};

const VIEW_PROJECTION = {
  githubInstallationId: 1,
  accountLogin: 1,
  accountType: 1,
  status: 1,
  monthlyTokenBudget: 1,
  allowedProviders: 1,
} as const;

type LeanInstallation = {
  _id: Types.ObjectId;
  githubInstallationId: number;
  accountLogin: string;
  accountType: AccountType;
  status: InstallationStatus;
  monthlyTokenBudget: number;
  allowedProviders: LlmProviderName[];
};

function toView(doc: LeanInstallation): InstallationView {
  return {
    id: doc._id.toString(),
    githubInstallationId: doc.githubInstallationId,
    accountLogin: doc.accountLogin,
    accountType: doc.accountType,
    status: doc.status,
    monthlyTokenBudget: doc.monthlyTokenBudget,
    allowedProviders: doc.allowedProviders,
  };
}

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
        VIEW_PROJECTION,
      ).lean<LeanInstallation>();
      return doc ? toView(doc) : null;
    },

    async findById(installationId) {
      const doc = await InstallationModel.findOne(
        { _id: new Types.ObjectId(installationId) },
        VIEW_PROJECTION,
      ).lean<LeanInstallation>();
      return doc ? toView(doc) : null;
    },

    async listActive(limit) {
      const docs = await InstallationModel.find({ status: 'active' }, VIEW_PROJECTION)
        .sort({ _id: 1 })
        .limit(limit)
        .lean<LeanInstallation[]>();
      return docs.map(toView);
    },

    async setBudget(installationId, monthlyTokenBudget) {
      await InstallationModel.updateOne(
        { _id: new Types.ObjectId(installationId) },
        { $set: { monthlyTokenBudget } },
      );
    },
  };
}
