import {
  JOB_NAMES,
  QUEUE_JOB_OPTIONS,
  QUEUE_NAMES,
  buildIndexJobId,
  type IndexRepoJobData,
} from '@mergemind/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export type IndexProducer = {
  /** Adds an `index.repo` job keyed by `buildIndexJobId`; re-adding the same id is a no-op. */
  enqueue(data: IndexRepoJobData): Promise<string>;
  close(): Promise<void>;
};

export type IndexProducerOptions = {
  connection: Redis;
  /** BullMQ key prefix; tests use a unique one per file. */
  prefix?: string;
};

export function createIndexProducer({ connection, prefix }: IndexProducerOptions): IndexProducer {
  const queue = new Queue<IndexRepoJobData>(QUEUE_NAMES.index, {
    connection,
    defaultJobOptions: QUEUE_JOB_OPTIONS.index,
    ...(prefix === undefined ? {} : { prefix }),
  });
  return {
    async enqueue(data) {
      const jobId = buildIndexJobId(data);
      await queue.add(JOB_NAMES.indexRepo, data, { jobId });
      return jobId;
    },
    close: () => queue.close(),
  };
}
