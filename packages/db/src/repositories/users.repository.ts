import { Types } from 'mongoose';

import { UserModel, type UserRole } from '../models/user.model.js';

export type { UserRole } from '../models/user.model.js';

export type UserAccess = { installationId: string; role: UserRole };

export type UserView = {
  githubUserId: number;
  login: string;
  access: UserAccess[];
  checkedInstallationIds: string[];
  accessCheckedAt: Date | null;
};

export type UsersRepository = {
  findByGithubUserId(githubUserId: number): Promise<UserView | null>;
  /** Replaces the cached access list (ADR-030); creates the user on first sign-in. */
  saveAccess(input: {
    githubUserId: number;
    login: string;
    access: readonly UserAccess[];
    checkedInstallationIds: readonly string[];
    checkedAt: Date;
  }): Promise<void>;
};

export function createUsersRepository(): UsersRepository {
  return {
    async findByGithubUserId(githubUserId) {
      const doc = await UserModel.findOne(
        { githubUserId },
        { githubUserId: 1, login: 1, access: 1, checkedInstallationIds: 1, accessCheckedAt: 1 },
      ).lean();
      if (!doc) {
        return null;
      }
      return {
        githubUserId: doc.githubUserId,
        login: doc.login,
        access: doc.access.map((entry) => ({
          installationId: entry.installationId.toString(),
          role: entry.role,
        })),
        checkedInstallationIds: doc.checkedInstallationIds.map((id) => id.toString()),
        accessCheckedAt: doc.accessCheckedAt ?? null,
      };
    },

    async saveAccess({ githubUserId, login, access, checkedInstallationIds, checkedAt }) {
      await UserModel.updateOne(
        { githubUserId },
        {
          $set: {
            login,
            accessCheckedAt: checkedAt,
            checkedInstallationIds: checkedInstallationIds.map((id) => new Types.ObjectId(id)),
            access: access.map((entry) => ({
              installationId: new Types.ObjectId(entry.installationId),
              role: entry.role,
            })),
          },
        },
        { upsert: true },
      );
    },
  };
}
