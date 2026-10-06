import {
  JOB_NAMES,
  QUEUE_JOB_OPTIONS,
  QUEUE_NAMES,
  buildCiSummaryJobId,
  type CiSummaryJobData,
} from '@mergemind/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export type CiSummaryProducer = {
  /** Adds a `ci-summary.run` job keyed by `buildCiSummaryJobId`; re-adding the id is a no-op. */
  enqueue(data: CiSummaryJobData): Promise<string>;
  close(): Promise<void>;
};

export type CiSummaryProducerOptions = {
  connection: Redis;
  /** BullMQ key prefix; tests use a unique one per file. */
  prefix?: string;
};

export function createCiSummaryProducer({
  connection,
  prefix,
}: CiSummaryProducerOptions): CiSummaryProducer {
  const queue = new Queue<CiSummaryJobData>(QUEUE_NAMES.ciSummary, {
    connection,
    defaultJobOptions: QUEUE_JOB_OPTIONS.ciSummary,
    ...(prefix === undefined ? {} : { prefix }),
  });
  return {
    async enqueue(data) {
      const jobId = buildCiSummaryJobId(data);
      await queue.add(JOB_NAMES.ciSummaryRun, data, { jobId });
      return jobId;
    },
    close: () => queue.close(),
  };
}
