import { PullRequestEventSchema, ReviewPrJobDataSchema } from '@mergemind/shared';
import { loadGithubFixture } from '@mergemind/shared/testing';
import { describe, expect, it } from 'vitest';

import { toPullRequestState, toReviewJobData } from './pull-request.handler.js';

async function loadEvent(name: string) {
  const { payload } = await loadGithubFixture(name);
  return PullRequestEventSchema.parse(payload);
}

describe('toReviewJobData', () => {
  it('maps a pull_request.opened payload to valid review.pr job data', async () => {
    const event = await loadEvent('pull_request.opened');

    const data = toReviewJobData(event, 'delivery-1', 'opened');

    expect(ReviewPrJobDataSchema.parse(data)).toEqual({
      deliveryId: 'delivery-1',
      githubInstallationId: 55500001,
      githubRepoId: 77700001,
      repoFullName: 'octo-demo/payments-api',
      isPrivate: true,
      defaultBranch: 'main',
      prNumber: 42,
      title: 'Add refund endpoint',
      authorLogin: 'dev-alice',
      baseRef: 'main',
      headRef: 'feat/refunds',
      baseSha: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
      headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      isDraft: false,
      trigger: 'opened',
      githubUpdatedAt: '2026-10-05T10:00:00Z',
    });
  });
});

describe('toPullRequestState', () => {
  it('maps a merged close to merged', async () => {
    const event = await loadEvent('pull_request.closed');

    expect(toPullRequestState(event.pull_request)).toBe('merged');
  });

  it('maps an unmerged close to closed', async () => {
    const event = await loadEvent('pull_request.closed');

    expect(toPullRequestState({ ...event.pull_request, merged: false })).toBe('closed');
  });

  it('maps an open PR to open', async () => {
    const event = await loadEvent('pull_request.opened');

    expect(toPullRequestState(event.pull_request)).toBe('open');
  });
});
