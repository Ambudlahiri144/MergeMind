import { Schema, type Types } from 'mongoose';

import { defineModel } from './define-model.js';

export const CHUNK_KINDS = [
  'function',
  'class',
  'method',
  'interface',
  'type',
  'module',
  'window',
] as const;
export type ChunkKind = (typeof CHUNK_KINDS)[number];

/** One symbol (or line window) of a repo's default branch, embedded for retrieval (PRD F6). */
export type CodeChunkRecord = {
  repositoryId: Types.ObjectId;
  path: string;
  /** Qualified and unique within the file, e.g. `UserService.save`, `save#2`, `lines:1-60`. */
  symbol: string;
  /** Last segment of `symbol` (`save`), for definition lookup by called name. */
  name: string;
  kind: ChunkKind;
  language: string;
  startLine: number;
  endLine: number;
  /** sha256 of `content`; an unchanged hash is never re-embedded. */
  contentHash: string;
  content: string;
  embedding: number[];
  embeddingModel: string;
  commitSha: string;
  createdAt: Date;
  updatedAt: Date;
};

const codeChunkSchema = new Schema<CodeChunkRecord>(
  {
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    path: { type: String, required: true },
    symbol: { type: String, required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: CHUNK_KINDS, required: true },
    language: { type: String, required: true },
    startLine: { type: Number, required: true },
    endLine: { type: Number, required: true },
    contentHash: { type: String, required: true },
    content: { type: String, required: true },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, required: true },
    commitSha: { type: String, required: true },
  },
  { timestamps: true, collection: 'codeChunks' },
);

codeChunkSchema.index({ repositoryId: 1, path: 1, symbol: 1 }, { unique: true });
codeChunkSchema.index({ repositoryId: 1, name: 1 });

export const CodeChunkModel = defineModel('CodeChunk', codeChunkSchema);
