import { IndexRepoJobDataSchema, JOB_NAMES } from '@mergemind/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

import { runIndex, type IndexDeps, type IndexOutcome } from '../indexing/index-repo.js';

/** `index.repo` processor: validate the job (rules.md §3), then index the default branch. */
export function createIndexProcessor(deps: IndexDeps) {
  return async (job: Job<unknown>): Promise<IndexOutcome> => {
    if (job.name !== JOB_NAMES.indexRepo) {
      throw new UnrecoverableError(`Unknown job name on the index queue: ${job.name}`);
    }
    const parsed = IndexRepoJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid index.repo job data: ${z.prettifyError(parsed.error)}`);
    }
    return runIndex(parsed.data, { ...deps, logger: deps.logger.child({ jobId: job.id }) });
  };
}
