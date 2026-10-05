import { Redis } from 'ioredis';

/**
 * BullMQ workers need `maxRetriesPerRequest: null` so blocking commands are never cut short.
 * https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest
 */
export function createWorkerRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
