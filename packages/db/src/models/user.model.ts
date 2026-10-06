import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

export const USER_ROLES = ['owner', 'admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type UserAccessRecord = { installationId: Types.ObjectId; role: UserRole };

/**
 * A signed-in GitHub user and the installations they may see, resolved by the api from GitHub
 * and cached for a few minutes (ADR-030). Sessions live in the web's cookie, not here.
 */
export type UserRecord = {
  githubUserId: number;
  login: string;
  access: UserAccessRecord[];
  /** Installations the cached `access` was resolved against; a new one forces a refresh. */
  checkedInstallationIds: Types.ObjectId[];
  accessCheckedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const userSchema = new Schema<UserRecord>(
  {
    githubUserId: { type: Number, required: true },
    login: { type: String, required: true },
    access: {
      type: [
        new Schema<UserAccessRecord>(
          {
            installationId: { type: Schema.Types.ObjectId, ref: 'Installation', required: true },
            role: { type: String, enum: USER_ROLES, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    checkedInstallationIds: { type: [Schema.Types.ObjectId], default: [] },
    accessCheckedAt: { type: Date },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ githubUserId: 1 }, { unique: true });

export const UserModel = defineModel('User', userSchema);
