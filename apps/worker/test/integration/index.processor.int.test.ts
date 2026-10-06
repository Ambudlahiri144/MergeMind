import { createHash, randomUUID } from 'node:crypto';

import {
  connectMongo,
  createCodeChunksRepository,
  createInstallationsRepository,
  createRepositoriesRepository,
  createUsageLedgerRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import { createGithubApp } from '@mergemind/github';
import { createFakeGithub, createTestPrivateKey } from '@mergemind/github/testing';
import type { Embedder } from '@mergemind/llm';
import type { IndexRepoJobData } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { runIndex, type IndexDeps } from '../../src/indexing/index-repo.js';

const fakeGithub = createFakeGithub();
const server = setupServer(...fakeGithub.handlers);
const logger = createLogger({ name: 'test', level: 'silent' });
const github = createGithubApp({
  appId: 4243,
  privateKey: createTestPrivateKey(),
  logger,
  retries: 0,
  isThrottled: false,
});
const installations = createInstallationsRepository();
const repositories = createRepositoriesRepository();
const codeChunks = createCodeChunksRepository();
const usageLedger = createUsageLedgerRepository();

/** Deterministic 768-dim vectors; records every text it was asked to embed. */
function createFakeEmbedder(): Embedder & { texts: string[] } {
  const texts: string[] = [];
  const toVector = (text: string) => {
    const digest = createHash('sha256').update(text).digest();
    return Array.from({ length: 768 }, (_, index) => (digest[index % digest.length] ?? 0) / 255);
  };
  return {
    model: 'fake-embed',
    texts,
    embedDocuments(input) {
      texts.push(...input);
      return Promise.resolve({ embeddings: input.map(toVector), tokens: input.length * 10 });
    },
    embedQuery(text) {
      return Promise.resolve({ embedding: toVector(text), tokens: 5 });
    },
  };
}

const USERS_V1 = [
  "import { db } from './db';",
  'export function findUser(id: string) {',
  '  return db.users.find(id);',
  '}',
  'export function saveUser(user: User) {',
  '  db.users.insert(user);',
  '}',
].join('\n');
const USERS_V2 = USERS_V1.replace('  db.users.insert(user);', '  return db.users.insert(user);');
const ORDERS = 'def total(order):\n    return sum(item.price for item in order.items)';

let nextId = 840_000;

async function createRepo(
  options: { isPrivate?: boolean; allowedProviders?: ('groq' | 'ollama')[] } = {},
) {
  nextId += 1;
  const githubInstallationId = nextId;
  const githubRepoId = nextId + 100_000;
  const fullName = `octo-demo/indexed-${nextId}`;
  const installationId = await installations.upsertFromGithub({
    githubInstallationId,
    accountLogin: 'octo-demo',
    accountType: 'Organization',
    status: 'active',
  });
  if (options.allowedProviders) {
    await mongoose.connection
      .collection('installations')
      .updateOne(
        { githubInstallationId },
        { $set: { allowedProviders: options.allowedProviders } },
      );
  }
  await repositories.upsertForInstallation(installationId, {
    githubRepoId,
    fullName,
    isPrivate: options.isPrivate ?? false,
  });
  const job: IndexRepoJobData = {
    githubInstallationId,
    githubRepoId,
    repoFullName: fullName,
    isPrivate: options.isPrivate ?? false,
    defaultBranch: null,
    commitSha: null,
    trigger: 'installation',
  };
  return { fullName, githubRepoId, job };
}

function publishCommit(fullName: string, sha: string, files: Record<string, string>) {
  const treeSha = `tree-${sha}`;
  fakeGithub.branches.set(`${fullName}:main`, { sha, treeSha });
  fakeGithub.trees.set(`${fullName}:${treeSha}`, {
    entries: Object.entries(files).map(([path, content]) => {
      const blobSha = createHash('sha1').update(content).digest('hex');
      fakeGithub.blobs.set(`${fullName}:${blobSha}`, content);
      return { path, sha: blobSha, size: content.length };
    }),
  });
}

function buildDeps(embedder: Embedder): IndexDeps {
  return {
    installations,
    repositories,
    codeChunks,
    usageLedger,
    github,
    embedder,
    logger,
    now: () => new Date(),
    limits: { maxFiles: 1_500, maxFileBytes: 200_000 },
  };
}

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

afterAll(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('index.repo (PRD F6)', () => {
  it('indexes the default branch by symbol on the first run, skipping non-code and vendored files', async () => {
    const { fullName, githubRepoId, job } = await createRepo();
    fakeGithub.repoInfo.set(fullName, { defaultBranch: 'main', isPrivate: false });
    publishCommit(fullName, SHA_1, {
      'src/users.ts': USERS_V1,
      'app/orders.py': ORDERS,
      'dist/bundle.js': 'function x() {}',
      'README.md': '# readme',
    });
    const embedder = createFakeEmbedder();

    const outcome = await runIndex(job, buildDeps(embedder));

    expect(outcome).toMatchObject({ status: 'indexed', mode: 'full', sha: SHA_1, filesIndexed: 2 });
    const repo = await repositories.findByGithubRepoId(githubRepoId);
    expect(repo).toMatchObject({
      indexStatus: 'ready',
      lastIndexedSha: SHA_1,
      defaultBranch: 'main',
    });
    expect((await codeChunks.listPaths(repo?.id ?? '')).sort()).toEqual([
      'app/orders.py',
      'src/users.ts',
    ]);
    expect(embedder.texts.some((text) => text.startsWith('src/users.ts\nfindUser\n'))).toBe(true);
    expect(embedder.texts.some((text) => text.includes('dist/bundle.js'))).toBe(false);
  });

  it('re-embeds only changed symbols and drops removed files on the next push', async () => {
    const { fullName, githubRepoId, job } = await createRepo();
    fakeGithub.repoInfo.set(fullName, { defaultBranch: 'main', isPrivate: false });
    publishCommit(fullName, SHA_1, { 'src/users.ts': USERS_V1, 'app/orders.py': ORDERS });
    await runIndex(job, buildDeps(createFakeEmbedder()));
    publishCommit(fullName, SHA_2, { 'src/users.ts': USERS_V2 });
    fakeGithub.compares.set(`${fullName}:${SHA_1}...${SHA_2}`, {
      status: 'ahead',
      files: [
        { filename: 'src/users.ts', status: 'modified', additions: 1, deletions: 1 },
        { filename: 'app/orders.py', status: 'removed', additions: 0, deletions: 2 },
      ],
    });
    const embedder = createFakeEmbedder();

    const outcome = await runIndex(
      { ...job, commitSha: SHA_2, defaultBranch: 'main', trigger: 'push' },
      buildDeps(embedder),
    );

    expect(outcome).toMatchObject({ status: 'indexed', mode: 'incremental', sha: SHA_2 });
    // Only saveUser changed; findUser and the module chunk keep their embeddings.
    expect(embedder.texts.map((text) => text.split('\n')[1])).toEqual(['saveUser']);
    const repo = await repositories.findByGithubRepoId(githubRepoId);
    expect(await codeChunks.listPaths(repo?.id ?? '')).toEqual(['src/users.ts']);
    expect(repo?.lastIndexedSha).toBe(SHA_2);
  });

  it('skips a head that is already indexed (idempotent redelivery)', async () => {
    const { fullName, job } = await createRepo();
    fakeGithub.repoInfo.set(fullName, { defaultBranch: 'main', isPrivate: false });
    publishCommit(fullName, SHA_1, { 'src/users.ts': USERS_V1 });
    await runIndex(job, buildDeps(createFakeEmbedder()));
    const embedder = createFakeEmbedder();

    const outcome = await runIndex(job, buildDeps(embedder));

    expect(outcome).toEqual({ status: 'skipped', reason: 'already_indexed' });
    expect(embedder.texts).toHaveLength(0);
  });

  it('runs a manual reindex of an indexed head without re-embedding unchanged code', async () => {
    const { fullName, job } = await createRepo();
    fakeGithub.repoInfo.set(fullName, { defaultBranch: 'main', isPrivate: false });
    publishCommit(fullName, SHA_1, { 'src/users.ts': USERS_V1 });
    await runIndex(job, buildDeps(createFakeEmbedder()));
    const embedder = createFakeEmbedder();

    const outcome = await runIndex({ ...job, trigger: 'manual' }, buildDeps(embedder));

    expect(outcome).toMatchObject({ status: 'indexed', mode: 'full' });
    expect(embedder.texts).toHaveLength(0);
  });

  it('never embeds a private repo whose installation does not allow Ollama', async () => {
    const { job } = await createRepo({ isPrivate: true, allowedProviders: ['groq'] });
    const embedder = createFakeEmbedder();

    const outcome = await runIndex(job, buildDeps(embedder));

    expect(outcome).toEqual({ status: 'skipped', reason: 'embedding_provider_not_allowed' });
    expect(embedder.texts).toHaveLength(0);
  });

  it('marks the repo failed when embedding fails, so a retry can index it', async () => {
    const { fullName, githubRepoId, job } = await createRepo();
    fakeGithub.repoInfo.set(fullName, { defaultBranch: 'main', isPrivate: false });
    publishCommit(fullName, SHA_1, { 'src/users.ts': USERS_V1 });
    const broken: Embedder = {
      model: 'fake-embed',
      embedDocuments: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:11434')),
      embedQuery: () => Promise.reject(new Error('down')),
    };

    await expect(runIndex(job, buildDeps(broken))).rejects.toThrow('ECONNREFUSED');

    expect((await repositories.findByGithubRepoId(githubRepoId))?.indexStatus).toBe('failed');
  });
});
