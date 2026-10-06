import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { connectMongo, disconnectMongo } from '../../src/connection.js';
import { ensureDbIndexes } from '../../src/indexes.js';
import {
  createCodeChunksRepository,
  type CodeChunkInput,
} from '../../src/repositories/code-chunks.repository.js';
import {
  EMBEDDING_DIMENSIONS,
  ensureVectorSearchIndex,
  waitForVectorSearchIndex,
} from '../../src/vector-index.js';

const chunks = createCodeChunksRepository();
const INDEX_READY_TIMEOUT_MS = 120_000;
const SEARCH_VISIBLE_TIMEOUT_MS = 60_000;

/** A unit vector pointing mostly along `axis`, so similarity is easy to reason about. */
function vector(axis: number, noise = 0): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === axis ? 1 : index === axis + 1 ? noise : 0,
  );
}

function chunk(overrides: Partial<CodeChunkInput> = {}): CodeChunkInput {
  return {
    path: 'src/users.ts',
    symbol: 'findUser',
    name: 'findUser',
    kind: 'function',
    language: 'typescript',
    startLine: 1,
    endLine: 5,
    contentHash: 'h1',
    content: 'export function findUser(id) { return db.users.find(id); }',
    embedding: vector(0),
    embeddingModel: 'nomic-embed-text',
    commitSha: 'a'.repeat(40),
    ...overrides,
  };
}

const repoA = new mongoose.Types.ObjectId().toString();
const repoB = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
}, INDEX_READY_TIMEOUT_MS);

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('codeChunks repository', () => {
  it('upserts by (repo, path, symbol), reports hashes, and deletes stale symbols and paths', async () => {
    const repo = new mongoose.Types.ObjectId().toString();
    await chunks.upsertMany(repo, [chunk(), chunk({ symbol: 'saveUser', name: 'saveUser' })]);
    await chunks.upsertMany(repo, [chunk({ contentHash: 'h2' })]);

    const hashes = await chunks.hashesForPaths(repo, ['src/users.ts', 'src/none.ts']);
    const staleDeleted = await chunks.deleteStale(repo, 'src/users.ts', ['findUser']);
    await chunks.upsertMany(repo, [chunk({ path: 'src/old.ts' })]);
    const pathDeleted = await chunks.deleteForPaths(repo, ['src/old.ts']);

    expect(hashes.get('src/users.ts')).toEqual(
      new Map([
        ['findUser', 'h2'],
        ['saveUser', 'h1'],
      ]),
    );
    expect(staleDeleted).toBe(1);
    expect(pathDeleted).toBe(1);
    expect(await chunks.countForRepo(repo)).toBe(1);
  });

  it('finds definitions by bare name', async () => {
    const repo = new mongoose.Types.ObjectId().toString();
    await chunks.upsertMany(repo, [chunk({ symbol: 'UserService.save', name: 'save' })]);

    const hits = await chunks.findByNames(repo, ['save', 'unknown'], 5);

    expect(hits.map((hit) => hit.symbol)).toEqual(['UserService.save']);
  });
});

describe('Atlas Vector Search on atlas-local (Testing.md §4)', () => {
  it(
    'creates the index and returns the nearest chunk of the requested repository only',
    async () => {
      await chunks.upsertMany(repoA, [
        chunk({ symbol: 'findUser', embedding: vector(0) }),
        chunk({ symbol: 'chargeCard', name: 'chargeCard', embedding: vector(10) }),
      ]);
      await chunks.upsertMany(repoB, [chunk({ symbol: 'findUser', embedding: vector(0) })]);

      const status = await ensureVectorSearchIndex();
      const isReady = await waitForVectorSearchIndex(INDEX_READY_TIMEOUT_MS);
      // The index is eventually consistent after writes: poll until the seeded chunks show up.
      let hits: Awaited<ReturnType<typeof chunks.vectorSearch>> = [];
      const deadline = Date.now() + SEARCH_VISIBLE_TIMEOUT_MS;
      while (Date.now() < deadline && hits.length < 2) {
        hits = await chunks.vectorSearch(repoA, vector(0, 0.1), 2);
        if (hits.length < 2) {
          await sleep(1_000);
        }
      }

      expect(['created', 'exists']).toContain(status.status);
      expect(isReady).toBe(true);
      expect(hits.map((hit) => hit.symbol)).toEqual(['findUser', 'chargeCard']);
      expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 1);
      expect(await ensureVectorSearchIndex()).toEqual({ status: 'exists' });
    },
    INDEX_READY_TIMEOUT_MS + SEARCH_VISIBLE_TIMEOUT_MS,
  );
});
