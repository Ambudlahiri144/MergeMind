import { JOB_NAMES } from '@mergemind/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { createDisabledIndexProcessor } from './index.processor.js';

function job(name: string, data: unknown): Job<unknown> {
  return { name, data, id: 'job-1', attemptsMade: 0, opts: { attempts: 3 } } as Job<unknown>;
}

describe('index.repo processor with the code index turned off (INDEX_ENABLED=false)', () => {
  it('skips every valid job at once, so the queue drains without fetching or retrying', async () => {
    const process = createDisabledIndexProcessor();

    await expect(
      process(
        job(JOB_NAMES.indexRepo, {
          githubInstallationId: 1,
          githubRepoId: 2,
          repoFullName: 'ananya-iyer/payments',
          isPrivate: false,
          defaultBranch: 'main',
          commitSha: null,
          trigger: 'push',
        }),
      ),
    ).resolves.toEqual({ status: 'skipped', reason: 'index_disabled' });
  });

  it('still rejects a job name that does not belong on the queue', async () => {
    const process = createDisabledIndexProcessor();

    await expect(process(job('review.pr', {}))).rejects.toThrow(UnrecoverableError);
  });
});
