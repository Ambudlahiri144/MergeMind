import { UpstreamError } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGithubApp, type GithubInstallationClient } from './client.js';
import { runMarker } from './markdown.js';
import { createFakeGithub, createTestPrivateKey } from './testing/index.js';

const fake = createFakeGithub();
const server = setupServer(...fake.handlers);
const repo = { owner: 'octo-demo', repo: 'payments-api' };
const PATCH = '@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;';

const app = createGithubApp({
  appId: 12345,
  privateKey: createTestPrivateKey(),
  logger: createLogger({ name: 'test', level: 'silent' }),
  retries: 0,
});

let client: GithubInstallationClient;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  client = await app.forInstallation(55500001);
});

afterEach(() => {
  fake.reset();
});

afterAll(() => {
  server.close();
});

describe('installation auth', () => {
  it('mints one installation token and reuses it across clients', async () => {
    const other = await app.forInstallation(55500001);
    fake.fileContents.set('octo-demo/payments-api@sha1:.mergemind.yml', 'version: 1');

    await client.getFileText({ ...repo, path: '.mergemind.yml', ref: 'sha1' });
    await other.getFileText({ ...repo, path: '.mergemind.yml', ref: 'sha1' });

    expect(fake.tokensMinted).toBeLessThanOrEqual(1);
  });

  it('reads the installation account with the app JWT', async () => {
    fake.installations.set(777, { login: 'acme', type: 'User' });

    expect(await app.getInstallationAccount(777)).toEqual({ login: 'acme', type: 'User' });
  });
});

describe('getFileText', () => {
  it('returns raw text at a ref', async () => {
    fake.fileContents.set('octo-demo/payments-api@abc:.mergemind.yml', 'gate:\n  failOn: major\n');

    expect(await client.getFileText({ ...repo, path: '.mergemind.yml', ref: 'abc' })).toBe(
      'gate:\n  failOn: major\n',
    );
  });

  it('returns null when the file does not exist', async () => {
    expect(await client.getFileText({ ...repo, path: '.mergemind.yml', ref: 'abc' })).toBeNull();
  });

  it('wraps other failures in UpstreamError with the status', async () => {
    fake.failNext('GET', /contents/, 503);

    await expect(
      client.getFileText({ ...repo, path: '.mergemind.yml', ref: 'abc' }),
    ).rejects.toThrow(new UpstreamError('GitHub getContent failed (HTTP 503)', 'github'));
  });
});

describe('listPullRequestFiles', () => {
  it('follows pagination past 100 files', async () => {
    const files = Array.from({ length: 150 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: PATCH,
    }));
    fake.pullRequestFiles.set('octo-demo/payments-api#42', files);

    const listed = await client.listPullRequestFiles({ ...repo, pullNumber: 42 });

    expect(listed).toHaveLength(150);
    expect(listed[149]).toMatchObject({ filename: 'src/file-149.ts', patch: PATCH });
  });
});

describe('check runs', () => {
  it('creates an in-progress check and completes it with a conclusion', async () => {
    const id = await client.createCheckRun({ ...repo, headSha: 'abc', externalId: 'run-1' });

    await client.completeCheckRun({
      ...repo,
      checkRunId: id,
      conclusion: 'failure',
      title: 'Blocking findings',
      summary: 'details',
    });

    expect(fake.checkRuns).toEqual([
      expect.objectContaining({
        id,
        headSha: 'abc',
        externalId: 'run-1',
        status: 'completed',
        conclusion: 'failure',
        output: { title: 'Blocking findings', summary: 'details' },
      }),
    ]);
  });
});

describe('reviews', () => {
  const runId = '66f0a1b2c3d4e5f601234567';

  it('posts one review with inline comments and finds it again by marker', async () => {
    fake.pullRequestFiles.set('octo-demo/payments-api#42', [
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: PATCH },
    ]);

    const reviewId = await client.createReview({
      ...repo,
      pullNumber: 42,
      commitId: 'abc',
      body: `Summary\n\n${runMarker(runId)}`,
      comments: [{ path: 'src/a.ts', line: 2, body: 'inline' }],
    });

    expect(
      await client.findReviewByMarker({ ...repo, pullNumber: 42, marker: runMarker(runId) }),
    ).toBe(reviewId);
    expect(await client.listReviewComments({ ...repo, pullNumber: 42, reviewId })).toEqual([
      expect.objectContaining({ body: 'inline' }),
    ]);
  });

  it('returns null when no review carries the marker', async () => {
    expect(
      await client.findReviewByMarker({ ...repo, pullNumber: 42, marker: runMarker(runId) }),
    ).toBeNull();
  });

  it('surfaces GitHub rejecting a comment outside the diff as an UpstreamError (422)', async () => {
    fake.pullRequestFiles.set('octo-demo/payments-api#42', [
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: PATCH },
    ]);

    await expect(
      client.createReview({
        ...repo,
        pullNumber: 42,
        commitId: 'abc',
        body: 'x',
        comments: [{ path: 'src/a.ts', line: 99, body: 'off the diff' }],
      }),
    ).rejects.toThrow(/HTTP 422/);
  });
});
