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
  isThrottled: false,
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

describe('incremental review and indexing endpoints', () => {
  const file = {
    filename: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: PATCH,
  };

  it('compares two commits and flags a possibly truncated file list', async () => {
    fake.compares.set('octo-demo/payments-api:aaa...bbb', { status: 'ahead', files: [file] });
    fake.compares.set('octo-demo/payments-api:aaa...ccc', {
      status: 'ahead',
      files: Array.from({ length: 300 }, (_, index) => ({ ...file, filename: `f${index}.ts` })),
    });

    const small = await client.compareCommits({ ...repo, base: 'aaa', head: 'bbb' });
    const huge = await client.compareCommits({ ...repo, base: 'aaa', head: 'ccc' });

    expect(small).toEqual({
      status: 'ahead',
      files: [expect.objectContaining({ filename: 'src/a.ts', patch: PATCH })],
      isTruncated: false,
    });
    expect(huge?.isTruncated).toBe(true);
  });

  it('returns null when GitHub cannot compare (force-push, garbage-collected SHA)', async () => {
    expect(await client.compareCommits({ ...repo, base: 'gone', head: 'bbb' })).toBeNull();
  });

  it('reads the branch head, its recursive tree and blob text', async () => {
    fake.branches.set('octo-demo/payments-api:main', { sha: 'head1', treeSha: 'tree1' });
    fake.trees.set('octo-demo/payments-api:tree1', {
      entries: [{ path: 'src/a.ts', sha: 'blob1', size: 12 }],
      truncated: false,
    });
    fake.blobs.set('octo-demo/payments-api:blob1', 'export const a = 1;\n');

    const head = await client.getBranchHead({ ...repo, branch: 'main' });
    const tree = await client.getTree({ ...repo, treeSha: head.treeSha });
    const text = await client.getBlobText({ ...repo, sha: tree.entries[0]?.sha ?? '' });

    expect(head).toEqual({ sha: 'head1', treeSha: 'tree1' });
    expect(tree).toEqual({
      entries: [{ path: 'src/a.ts', sha: 'blob1', size: 12 }],
      isTruncated: false,
    });
    expect(text).toBe('export const a = 1;\n');
  });

  it('replies to a review comment and lists it with in_reply_to', async () => {
    fake.pullRequestFiles.set('octo-demo/payments-api#42', [file]);
    const reviewId = await client.createReview({
      ...repo,
      pullNumber: 42,
      commitId: 'abc',
      body: 'x',
      comments: [{ path: 'src/a.ts', line: 2, body: 'inline' }],
    });
    const [comment] = await client.listReviewComments({ ...repo, pullNumber: 42, reviewId });

    const replyId = await client.replyToReviewComment({
      ...repo,
      pullNumber: 42,
      commentId: comment?.id ?? 0,
      body: 'Resolved',
    });

    expect(await client.listPullRequestComments({ ...repo, pullNumber: 42 })).toEqual([
      { id: comment?.id, body: 'inline', inReplyToId: null },
      { id: replyId, body: 'Resolved', inReplyToId: comment?.id },
    ]);
  });

  it('resolves the threads of given comments, and reports a permission refusal instead of throwing', async () => {
    fake.pullRequestFiles.set('octo-demo/payments-api#42', [file]);
    const reviewId = await client.createReview({
      ...repo,
      pullNumber: 42,
      commitId: 'abc',
      body: 'x',
      comments: [{ path: 'src/a.ts', line: 2, body: 'inline' }],
    });
    const [comment] = await client.listReviewComments({ ...repo, pullNumber: 42, reviewId });
    const commentIds = [comment?.id ?? 0];

    fake.isThreadResolveForbidden = true;
    const refused = await client.resolveReviewThreads({ ...repo, pullNumber: 42, commentIds });
    fake.isThreadResolveForbidden = false;
    const resolved = await client.resolveReviewThreads({ ...repo, pullNumber: 42, commentIds });

    expect(refused).toEqual({ resolvedCount: 0, isPermissionDenied: true });
    expect(resolved).toEqual({ resolvedCount: 1, isPermissionDenied: false });
    expect(fake.resolvedThreads.has(`thread-${comment?.id}`)).toBe(true);
  });
});

describe('CI summary endpoints (PRD F10)', () => {
  const SHA = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';

  it('lists the jobs of one run attempt across pages', async () => {
    const jobs = Array.from({ length: 101 }, (_, index) => ({
      id: index + 1,
      name: `job ${index + 1}`,
      conclusion: index === 100 ? 'failure' : 'success',
      html_url: `https://github.com/octo-demo/payments-api/actions/runs/9/job/${index + 1}`,
      steps: [{ name: 'Run tests', number: 3, conclusion: 'failure' }],
    }));
    fake.runJobs.set('octo-demo/payments-api:9@2', jobs);

    const listed = await client.listRunJobs({ ...repo, runId: 9, attempt: 2 });

    expect(listed).toHaveLength(101);
    expect(listed.at(-1)).toEqual({
      id: 101,
      name: 'job 101',
      conclusion: 'failure',
      htmlUrl: 'https://github.com/octo-demo/payments-api/actions/runs/9/job/101',
      steps: [{ name: 'Run tests', number: 3, conclusion: 'failure' }],
    });
  });

  it('reads a job log as text, and null once it expired (404 or 410)', async () => {
    fake.jobLogs.set('octo-demo/payments-api:7', '2026-10-06T10:00:00.0000000Z ##[error]boom\n');

    expect(await client.getJobLog({ ...repo, jobId: 7 })).toContain('##[error]boom');
    expect(await client.getJobLog({ ...repo, jobId: 8 })).toBeNull();
    fake.failNext('GET', /actions\/jobs\/7\/logs/, 410);
    expect(await client.getJobLog({ ...repo, jobId: 7 })).toBeNull();
  });

  it('finds PRs by commit and reads a PR state', async () => {
    fake.commitPulls.set(`octo-demo/payments-api:${SHA}`, [
      { number: 42, state: 'open', headSha: SHA },
    ]);
    fake.pullStates.set('octo-demo/payments-api#42', { state: 'closed', headSha: SHA });

    expect(await client.listPullRequestsForCommit({ ...repo, sha: SHA })).toEqual([
      { number: 42, state: 'open', headSha: SHA },
    ]);
    expect(await client.getPullRequestState({ ...repo, pullNumber: 42 })).toEqual({
      number: 42,
      state: 'closed',
      headSha: SHA,
    });
  });

  it('creates, finds by marker and updates one PR conversation comment', async () => {
    const id = await client.createIssueComment({
      ...repo,
      issueNumber: 42,
      body: 'CI failed <!-- mergemind:ci-workflow=5 -->',
    });

    const found = await client.findIssueCommentByMarker({
      ...repo,
      issueNumber: 42,
      marker: '<!-- mergemind:ci-workflow=5 -->',
    });
    await client.updateIssueComment({ ...repo, commentId: id, body: 'CI passing' });

    expect(found?.id).toBe(id);
    expect(fake.issueComments).toEqual([
      expect.objectContaining({ id, issueNumber: 42, body: 'CI passing', editCount: 1 }),
    ]);
    expect(
      await client.findIssueCommentByMarker({ ...repo, issueNumber: 42, marker: 'absent' }),
    ).toBeNull();
  });
});

describe('getOrgMembership (ADR-030)', () => {
  it('reads an active admin, and null for a non-member', async () => {
    fake.orgMemberships.set('octo-demo:rohan-mehta', { role: 'admin', state: 'active' });

    expect(await client.getOrgMembership({ org: 'octo-demo', username: 'rohan-mehta' })).toEqual({
      role: 'admin',
      state: 'active',
    });
    expect(await client.getOrgMembership({ org: 'octo-demo', username: 'stranger' })).toBeNull();
  });
});
