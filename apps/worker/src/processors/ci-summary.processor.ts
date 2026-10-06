import { CiSummaryJobDataSchema, JOB_NAMES } from '@mergemind/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

import { runCiSummary, type CiSummaryDeps, type CiSummaryOutcome } from '../ci/run-ci-summary.js';

/** `ci-summary.run` processor: validate the job (rules.md §3), then summarise (PRD F10). */
export function createCiSummaryProcessor(deps: CiSummaryDeps) {
  return async (job: Job<unknown>): Promise<CiSummaryOutcome> => {
    if (job.name !== JOB_NAMES.ciSummaryRun) {
      throw new UnrecoverableError(`Unknown job name on the ci-summary queue: ${job.name}`);
    }
    const parsed = CiSummaryJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Invalid ci-summary.run job data: ${z.prettifyError(parsed.error)}`,
      );
    }
    const attempts = job.opts.attempts ?? 1;
    return runCiSummary(
      parsed.data,
      { jobId: job.id ?? 'unknown', isFinalAttempt: job.attemptsMade + 1 >= attempts },
      deps,
    );
  };
}
