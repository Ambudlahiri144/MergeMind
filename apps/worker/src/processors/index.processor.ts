import { IndexRepoJobDataSchema, JOB_NAMES, type IndexRepoJobData } from '@mergemind/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

import { runIndex, type IndexDeps, type IndexOutcome } from '../indexing/index-repo.js';

function parseIndexJob(job: Job<unknown>): IndexRepoJobData {
  if (job.name !== JOB_NAMES.indexRepo) {
    throw new UnrecoverableError(`Unknown job name on the index queue: ${job.name}`);
  }
  const parsed = IndexRepoJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError(`Invalid index.repo job data: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** `index.repo` processor: validate the job (rules.md §3), then index the default branch. */
export function createIndexProcessor(deps: IndexDeps) {
  return async (job: Job<unknown>): Promise<IndexOutcome> =>
    runIndex(parseIndexJob(job), { ...deps, logger: deps.logger.child({ jobId: job.id }) });
}

/**
 * `INDEX_ENABLED=false` (hosts without room for Ollama, ADR-038): the queue is still consumed,
 * so jobs never pile up in Redis, but nothing is fetched, embedded or retried.
 */
export function createDisabledIndexProcessor() {
  return (job: Job<unknown>): Promise<IndexOutcome> =>
    // A rejected promise, never a synchronous throw, like every BullMQ processor.
    Promise.resolve().then(() => {
      parseIndexJob(job);
      return { status: 'skipped' as const, reason: 'index_disabled' };
    });
}
