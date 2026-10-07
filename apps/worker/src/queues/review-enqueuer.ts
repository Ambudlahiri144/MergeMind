import {
  JOB_NAMES,
  QUEUE_JOB_OPTIONS,
  QUEUE_NAMES,
  ReviewPrJobDataSchema,
  buildReviewJobId,
  type ReviewPrJobInput,
} from '@mergemind/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

/**
 * The worker's own `review.pr` producer, for boot reconciliation (ADR-038). Same job id and
 * options as the api's producer, so a job that survived is not added twice.
 */
export function createReviewEnqueuer(connection: Redis) {
  const queue = new Queue(QUEUE_NAMES.review, {
    connection,
    defaultJobOptions: QUEUE_JOB_OPTIONS.review,
  });
  return {
    async enqueue(input: ReviewPrJobInput): Promise<string> {
      const data = ReviewPrJobDataSchema.parse(input);
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
    close: () => queue.close(),
  };
}
