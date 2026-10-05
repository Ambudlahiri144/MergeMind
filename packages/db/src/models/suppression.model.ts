import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

/** A dismissed finding fingerprint; never reported again in this repo (PRD F8). */
export type SuppressionRecord = {
  repositoryId: Types.ObjectId;
  fingerprint: string;
  reason?: string;
  createdByLogin: string;
  createdAt: Date;
  updatedAt: Date;
};

const suppressionSchema = new Schema<SuppressionRecord>(
  {
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    fingerprint: { type: String, required: true },
    reason: { type: String },
    createdByLogin: { type: String, required: true },
  },
  { timestamps: true, collection: 'suppressions' },
);

suppressionSchema.index({ repositoryId: 1, fingerprint: 1 }, { unique: true });

export const SuppressionModel = defineModel('Suppression', suppressionSchema);
