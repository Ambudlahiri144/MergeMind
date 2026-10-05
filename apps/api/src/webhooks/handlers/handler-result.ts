import type { FinalDeliveryStatus } from '@mergemind/db';

/** What a handler did; becomes the delivery's final status and the 202 body. */
export type HandlerResult = {
  status: Exclude<FinalDeliveryStatus, 'failed'>;
  reason: string;
  jobId?: string;
};
