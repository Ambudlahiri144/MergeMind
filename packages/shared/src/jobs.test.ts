import { describe, expect, it } from 'vitest';

import {
  QUEUE_JOB_OPTIONS,
  buildCiSummaryJobId,
  buildIndexJobId,
  buildReviewJobId,
} from './jobs.js';

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('buildReviewJobId', () => {
  it('builds <repoId>#<prNumber>@<headSha> for the first attempt', () => {
    expect(buildReviewJobId({ githubRepoId: 777, prNumber: 42, headSha: HEAD_SHA })).toBe(
      `777#42@${HEAD_SHA}`,
    );
  });

  it('appends -a<attempt> for manual reruns', () => {
    expect(
      buildReviewJobId({ githubRepoId: 777, prNumber: 42, headSha: HEAD_SHA, attempt: 3 }),
    ).toBe(`777#42@${HEAD_SHA}-a3`);
  });

  it('suffixes ready_for_review so it never collides with the draft-time job', () => {
    expect(
      buildReviewJobId({
        githubRepoId: 777,
        prNumber: 42,
        headSha: HEAD_SHA,
        trigger: 'ready_for_review',
      }),
    ).toBe(`777#42@${HEAD_SHA}-ready`);
    expect(
      buildReviewJobId({
        githubRepoId: 777,
        prNumber: 42,
        headSha: HEAD_SHA,
        trigger: 'synchronize',
      }),
    ).toBe(`777#42@${HEAD_SHA}`);
  });

  it('never contains ":" because BullMQ rejects it in custom ids', () => {
    const ids = [1, 2, 10].map((attempt) =>
      buildReviewJobId({ githubRepoId: 1, prNumber: 1, headSha: HEAD_SHA, attempt }),
    );

    expect(ids.some((id) => id.includes(':'))).toBe(false);
  });
});

describe('QUEUE_JOB_OPTIONS', () => {
  it('matches the attempts in Architecture.md §5', () => {
    expect(QUEUE_JOB_OPTIONS.review.attempts).toBe(3);
    expect(QUEUE_JOB_OPTIONS.index.attempts).toBe(3);
    expect(QUEUE_JOB_OPTIONS.ciSummary.attempts).toBe(2);
  });
});

describe('buildIndexJobId', () => {
  it('keys index jobs by repo and commit, with a fixed id for the first index', () => {
    expect(buildIndexJobId({ githubRepoId: 7, commitSha: 'a'.repeat(40) })).toBe(
      `7@${'a'.repeat(40)}`,
    );
    expect(buildIndexJobId({ githubRepoId: 7, commitSha: null })).toBe('7@initial');
  });
});

describe('buildCiSummaryJobId', () => {
  it('gives each run attempt its own id without a colon', () => {
    const first = buildCiSummaryJobId({ githubRepoId: 777, workflowRunId: 8800, runAttempt: 1 });
    const rerun = buildCiSummaryJobId({ githubRepoId: 777, workflowRunId: 8800, runAttempt: 2 });

    expect(first).toBe('777#run8800-1');
    expect(rerun).toBe('777#run8800-2');
    expect(first).not.toContain(':');
  });
});
