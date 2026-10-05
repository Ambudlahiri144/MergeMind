import { INDEX_STATUSES, type IndexStatus } from '@mergemind/shared';
import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

export type RepositoryRecord = {
  installationId: Types.ObjectId;
  githubRepoId: number;
  fullName: string;
  isPrivate: boolean;
  /** Unknown until a pull_request or push payload names it (installation payloads omit it). */
  defaultBranch?: string;
  /** False after the repo is removed from the installation or the app is uninstalled (PRD F1). */
  isInstalled: boolean;
  /** The user's toggle from the web UI. Reviews need both flags true. */
  isEnabled: boolean;
  indexStatus: IndexStatus;
  lastIndexedSha?: string;
  createdAt: Date;
  updatedAt: Date;
};

const repositorySchema = new Schema<RepositoryRecord>(
  {
    installationId: { type: Schema.Types.ObjectId, ref: 'Installation', required: true },
    githubRepoId: { type: Number, required: true },
    fullName: { type: String, required: true },
    isPrivate: { type: Boolean, required: true },
    defaultBranch: { type: String },
    isInstalled: { type: Boolean, required: true, default: true },
    isEnabled: { type: Boolean, required: true, default: true },
    indexStatus: { type: String, enum: INDEX_STATUSES, required: true, default: 'none' },
    lastIndexedSha: { type: String },
  },
  { timestamps: true, collection: 'repositories' },
);

repositorySchema.index({ githubRepoId: 1 }, { unique: true });
repositorySchema.index({ installationId: 1, fullName: 1 });

export const RepositoryModel = defineModel('Repository', repositorySchema);
