import type { IndexStatus } from '@mergemind/shared';
import { Types, type AnyBulkWriteOperation } from 'mongoose';

import { RepositoryModel, type RepositoryRecord } from '../models/repository.model.js';

export type GithubRepositoryInput = {
  githubRepoId: number;
  fullName: string;
  isPrivate: boolean;
  defaultBranch?: string;
};

export type RepositoryView = {
  id: string;
  installationId: string;
  githubRepoId: number;
  fullName: string;
  isPrivate: boolean;
  defaultBranch?: string;
  isInstalled: boolean;
  isEnabled: boolean;
  indexStatus: IndexStatus;
  lastIndexedSha?: string;
};

export type RepositoriesRepository = {
  /** One bulkWrite for an installation's repos; marks each installed. Returns rows written. */
  upsertManyForInstallation(
    installationId: string,
    repos: readonly GithubRepositoryInput[],
  ): Promise<number>;
  upsertForInstallation(installationId: string, repo: GithubRepositoryInput): Promise<string>;
  markUninstalled(githubRepoIds: readonly number[]): Promise<number>;
  markAllUninstalledForInstallation(installationId: string): Promise<number>;
  findIdByGithubRepoId(githubRepoId: number): Promise<string | null>;
  findByGithubRepoId(githubRepoId: number): Promise<RepositoryView | null>;
  setIndexStatus(repositoryId: string, status: IndexStatus): Promise<void>;
  /** Index finished at `sha`: status `ready` and the base of the next incremental index. */
  markIndexed(repositoryId: string, sha: string): Promise<void>;
  setDefaultBranch(repositoryId: string, defaultBranch: string): Promise<void>;
};

function buildUpsert(installationId: string, repo: GithubRepositoryInput) {
  return {
    $set: {
      installationId: new Types.ObjectId(installationId),
      fullName: repo.fullName,
      isPrivate: repo.isPrivate,
      isInstalled: true,
      ...(repo.defaultBranch === undefined ? {} : { defaultBranch: repo.defaultBranch }),
    },
    // A reinstall must not override the user's isEnabled choice or the index state.
    $setOnInsert: { isEnabled: true, indexStatus: 'none' as const },
  };
}

export function createRepositoriesRepository(): RepositoriesRepository {
  return {
    async upsertManyForInstallation(installationId, repos) {
      if (repos.length === 0) {
        return 0;
      }
      const operations: AnyBulkWriteOperation<RepositoryRecord>[] = repos.map((repo) => ({
        updateOne: {
          filter: { githubRepoId: repo.githubRepoId },
          update: buildUpsert(installationId, repo),
          upsert: true,
        },
      }));
      const result = await RepositoryModel.bulkWrite(operations, { ordered: false });
      return result.upsertedCount + result.matchedCount;
    },

    async upsertForInstallation(installationId, repo) {
      const doc = await RepositoryModel.findOneAndUpdate(
        { githubRepoId: repo.githubRepoId },
        buildUpsert(installationId, repo),
        { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
      ).lean();
      if (!doc) {
        throw new Error(`Upsert returned no repository for ${repo.githubRepoId}`);
      }
      return doc._id.toString();
    },

    async markUninstalled(githubRepoIds) {
      if (githubRepoIds.length === 0) {
        return 0;
      }
      const result = await RepositoryModel.updateMany(
        { githubRepoId: { $in: githubRepoIds } },
        { $set: { isInstalled: false } },
      );
      return result.modifiedCount;
    },

    async markAllUninstalledForInstallation(installationId) {
      const result = await RepositoryModel.updateMany(
        { installationId: new Types.ObjectId(installationId) },
        { $set: { isInstalled: false } },
      );
      return result.modifiedCount;
    },

    async findIdByGithubRepoId(githubRepoId) {
      const doc = await RepositoryModel.findOne({ githubRepoId }, { _id: 1 }).lean();
      return doc ? doc._id.toString() : null;
    },

    async findByGithubRepoId(githubRepoId) {
      const doc = await RepositoryModel.findOne(
        { githubRepoId },
        {
          installationId: 1,
          githubRepoId: 1,
          fullName: 1,
          isPrivate: 1,
          defaultBranch: 1,
          isInstalled: 1,
          isEnabled: 1,
          indexStatus: 1,
          lastIndexedSha: 1,
        },
      ).lean();
      if (!doc) {
        return null;
      }
      return {
        id: doc._id.toString(),
        installationId: doc.installationId.toString(),
        githubRepoId: doc.githubRepoId,
        fullName: doc.fullName,
        isPrivate: doc.isPrivate,
        ...(doc.defaultBranch === undefined ? {} : { defaultBranch: doc.defaultBranch }),
        isInstalled: doc.isInstalled,
        isEnabled: doc.isEnabled,
        indexStatus: doc.indexStatus,
        ...(doc.lastIndexedSha === undefined ? {} : { lastIndexedSha: doc.lastIndexedSha }),
      };
    },

    async setIndexStatus(repositoryId, status) {
      await RepositoryModel.updateOne(
        { _id: new Types.ObjectId(repositoryId) },
        { $set: { indexStatus: status } },
      );
    },

    async markIndexed(repositoryId, sha) {
      await RepositoryModel.updateOne(
        { _id: new Types.ObjectId(repositoryId) },
        { $set: { indexStatus: 'ready', lastIndexedSha: sha } },
      );
    },

    async setDefaultBranch(repositoryId, defaultBranch) {
      await RepositoryModel.updateOne(
        { _id: new Types.ObjectId(repositoryId) },
        { $set: { defaultBranch } },
      );
    },
  };
}
