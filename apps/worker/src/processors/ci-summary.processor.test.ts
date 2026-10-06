import { JOB_NAMES } from '@mergemind/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { CiSummaryDeps } from '../ci/run-ci-summary.js';
import { createCiSummaryProcessor } from './ci-summary.processor.js';

const unusedDeps = {} as CiSummaryDeps;

function job(name: string, data: unknown): Job<unknown> {
  return { name, data, id: 'job-1', attemptsMade: 0, opts: { attempts: 2 } } as Job<unknown>;
}

describe('ci-summary.run processor', () => {
  it('fails invalid job data once, without retries', async () => {
    const process = createCiSummaryProcessor(unusedDeps);

    await expect(process(job(JOB_NAMES.ciSummaryRun, { workflowRunId: 'x' }))).rejects.toThrow(
      UnrecoverableError,
    );
  });

  it('rejects a job name that does not belong on the queue', async () => {
    const process = createCiSummaryProcessor(unusedDeps);

    await expect(process(job('review.pr', {}))).rejects.toThrow(/Unknown job name/);
  });
});
