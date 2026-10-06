import { Types, type AnyBulkWriteOperation } from 'mongoose';

import {
  CodeChunkModel,
  type ChunkKind,
  type CodeChunkRecord,
} from '../models/code-chunk.model.js';
import { CODE_CHUNKS_VECTOR_INDEX } from '../vector-index.js';

export type { ChunkKind } from '../models/code-chunk.model.js';

/** Hard cap per repository; protects Atlas M0's 512 MB (ADR-024). */
export const MAX_CHUNKS_PER_REPO = 6000;
/** Atlas recommends ~20x the result limit; it may not exceed 10,000. */
const CANDIDATES_PER_RESULT = 20;
const MAX_NUM_CANDIDATES = 10_000;

export type CodeChunkInput = {
  path: string;
  symbol: string;
  name: string;
  kind: ChunkKind;
  language: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  content: string;
  embedding: number[];
  embeddingModel: string;
  commitSha: string;
};

export type CodeChunkHit = {
  path: string;
  symbol: string;
  kind: ChunkKind;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
};

export type CodeChunksRepository = {
  /** `path → symbol → contentHash` for the given files, to skip re-embedding unchanged chunks. */
  hashesForPaths(
    repositoryId: string,
    paths: readonly string[],
  ): Promise<Map<string, Map<string, string>>>;
  upsertMany(repositoryId: string, chunks: readonly CodeChunkInput[]): Promise<number>;
  /** Re-labels unchanged chunks with the commit they were last seen at. */
  touchCommit(repositoryId: string, paths: readonly string[], commitSha: string): Promise<void>;
  deleteForPaths(repositoryId: string, paths: readonly string[]): Promise<number>;
  /** Removes a file's chunks whose symbol no longer exists. */
  deleteStale(repositoryId: string, path: string, keepSymbols: readonly string[]): Promise<number>;
  countForRepo(repositoryId: string): Promise<number>;
  /** Paths that currently have chunks (to drop files that left the tree). */
  listPaths(repositoryId: string): Promise<string[]>;
  /** `$vectorSearch` restricted to one repository (filter field `repositoryId`). */
  vectorSearch(
    repositoryId: string,
    vector: readonly number[],
    limit: number,
  ): Promise<CodeChunkHit[]>;
  /** Definitions by bare name (`name` field), e.g. functions a diff calls. */
  findByNames(
    repositoryId: string,
    names: readonly string[],
    limit: number,
  ): Promise<CodeChunkHit[]>;
};

const HIT_PROJECTION = {
  _id: 0,
  path: 1,
  symbol: 1,
  kind: 1,
  startLine: 1,
  endLine: 1,
  content: 1,
} as const;

export function createCodeChunksRepository(): CodeChunksRepository {
  const repoFilter = (repositoryId: string) => ({ repositoryId: new Types.ObjectId(repositoryId) });

  return {
    async hashesForPaths(repositoryId, paths) {
      const byPath = new Map<string, Map<string, string>>();
      if (paths.length === 0) {
        return byPath;
      }
      const docs = await CodeChunkModel.find(
        { ...repoFilter(repositoryId), path: { $in: paths } },
        { _id: 0, path: 1, symbol: 1, contentHash: 1 },
      )
        .limit(MAX_CHUNKS_PER_REPO)
        .lean();
      for (const doc of docs) {
        const symbols = byPath.get(doc.path) ?? new Map<string, string>();
        symbols.set(doc.symbol, doc.contentHash);
        byPath.set(doc.path, symbols);
      }
      return byPath;
    },

    async upsertMany(repositoryId, chunks) {
      if (chunks.length === 0) {
        return 0;
      }
      const repositoryObjectId = new Types.ObjectId(repositoryId);
      const operations: AnyBulkWriteOperation<CodeChunkRecord>[] = chunks.map((chunk) => ({
        updateOne: {
          filter: { repositoryId: repositoryObjectId, path: chunk.path, symbol: chunk.symbol },
          update: { $set: { ...chunk, repositoryId: repositoryObjectId } },
          upsert: true,
        },
      }));
      const result = await CodeChunkModel.bulkWrite(operations, { ordered: false });
      return result.upsertedCount + result.modifiedCount;
    },

    async touchCommit(repositoryId, paths, commitSha) {
      if (paths.length === 0) {
        return;
      }
      await CodeChunkModel.updateMany(
        { ...repoFilter(repositoryId), path: { $in: paths } },
        { $set: { commitSha } },
      );
    },

    async deleteForPaths(repositoryId, paths) {
      if (paths.length === 0) {
        return 0;
      }
      const result = await CodeChunkModel.deleteMany({
        ...repoFilter(repositoryId),
        path: { $in: paths },
      });
      return result.deletedCount;
    },

    async deleteStale(repositoryId, path, keepSymbols) {
      const result = await CodeChunkModel.deleteMany({
        ...repoFilter(repositoryId),
        path,
        symbol: { $nin: keepSymbols },
      });
      return result.deletedCount;
    },

    countForRepo: (repositoryId) => CodeChunkModel.countDocuments(repoFilter(repositoryId)),

    // Bounded by MAX_CHUNKS_PER_REPO documents per repository.
    listPaths: async (repositoryId) =>
      (await CodeChunkModel.distinct('path', repoFilter(repositoryId))).map(String),

    async vectorSearch(repositoryId, vector, limit) {
      return CodeChunkModel.aggregate<CodeChunkHit>([
        {
          $vectorSearch: {
            index: CODE_CHUNKS_VECTOR_INDEX,
            path: 'embedding',
            queryVector: [...vector],
            numCandidates: Math.min(MAX_NUM_CANDIDATES, limit * CANDIDATES_PER_RESULT),
            limit,
            // Aggregations are not cast by Mongoose: pass a real ObjectId.
            filter: { repositoryId: { $eq: new Types.ObjectId(repositoryId) } },
          },
        },
        { $project: { ...HIT_PROJECTION, score: { $meta: 'vectorSearchScore' } } },
      ]);
    },

    async findByNames(repositoryId, names, limit) {
      if (names.length === 0) {
        return [];
      }
      const docs = await CodeChunkModel.find(
        { ...repoFilter(repositoryId), name: { $in: names } },
        HIT_PROJECTION,
      )
        .limit(limit)
        .lean<Omit<CodeChunkHit, 'score'>[]>();
      // Exact name matches rank above any similarity score.
      return docs.map((doc) => ({ ...doc, score: 1 }));
    },
  };
}
