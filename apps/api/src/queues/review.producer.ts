import {
  JOB_NAMES,
  QUEUE_JOB_OPTIONS,
  QUEUE_NAMES,
  buildReviewJobId,
  type ReviewPrJobData,
} from '@mergemind/shared';
import { Queue, type JobState } from 'bullmq';
import type { Redis } from 'ioredis';

/** States in which no worker holds the job, so removing it cancels the review. */
const CANCELLABLE_STATES: ReadonlySet<JobState | 'unknown'> = new Set([
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

export type ReviewProducer = {
  /** Adds a `review.pr` job keyed by `buildReviewJobId`; re-adding the same id is a no-op. */
  enqueue(data: ReviewPrJobData): Promise<string>;
  /** Removes a job that has not started. Returns false if it is missing or already running. */
  cancel(jobId: string): Promise<boolean>;
  close(): Promise<void>;
};

export type ReviewProducerOptions = {
  connection: Redis;
  /** BullMQ key prefix; tests use a unique one per file. */
  prefix?: string;
};

function isLockedJobError(error: unknown): boolean {
  return error instanceof Error && /locked/i.test(error.message);
}

export function createReviewProducer({
  connection,
  prefix,
}: ReviewProducerOptions): ReviewProducer {
  const queue = new Queue<ReviewPrJobData>(QUEUE_NAMES.review, {
    connection,
    defaultJobOptions: QUEUE_JOB_OPTIONS.review,
    ...(prefix === undefined ? {} : { prefix }),
  });

  return {
    async enqueue(data) {
      const jobId = buildReviewJobId({
        githubRepoId: data.githubRepoId,
        prNumber: data.prNumber,
        headSha: data.headSha,
        trigger: data.trigger,
        attempt: data.attempt,
      });
      await queue.add(JOB_NAMES.reviewPr, data, { jobId });
      return jobId;
    },

    async cancel(jobId) {
      const job = await queue.getJob(jobId);
      if (!job || !CANCELLABLE_STATES.has(await job.getState())) {
        return false;
      }
      try {
        await job.remove();
        return true;
      } catch (error) {
        // A worker picked the job up between getState() and remove(); let that review finish.
        if (isLockedJobError(error)) {
          return false;
        }
        throw error;
      }
    },

    async close() {
      await queue.close();
    },
  };
}
