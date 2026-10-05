import { JOB_NAMES, ReviewPrJobDataSchema } from '@mergemind/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

import { runReview } from '../pipeline/run-review.js';
import type { ReviewDeps, ReviewOutcome } from '../pipeline/types.js';

/** `review.pr` processor: validate the job (rules.md §3), then run the pipeline. */
export function createReviewProcessor(deps: ReviewDeps) {
  return async (job: Job<unknown>): Promise<ReviewOutcome> => {
    if (job.name !== JOB_NAMES.reviewPr) {
      throw new UnrecoverableError(`Unknown job name on the review queue: ${job.name}`);
    }
    const parsed = ReviewPrJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      // Bad data never becomes good on retry, so fail now instead of burning attempts.
      throw new UnrecoverableError(`Invalid review.pr job data: ${z.prettifyError(parsed.error)}`);
    }
    const attempts = job.opts.attempts ?? 1;
    return runReview(
      parsed.data,
      {
        jobId: job.id ?? 'unknown',
        enqueuedAt: job.timestamp,
        isFinalAttempt: job.attemptsMade + 1 >= attempts,
      },
      deps,
    );
  };
}
