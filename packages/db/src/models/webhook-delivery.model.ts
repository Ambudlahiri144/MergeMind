import { WEBHOOK_DELIVERY_STATUSES, type WebhookDeliveryStatus } from '@mergemind/shared';
import { Schema } from 'mongoose';

import { defineModel } from './define-model.js';

/** Delivery log rows expire after 7 days (Architecture.md §4). */
export const WEBHOOK_DELIVERY_TTL_SECONDS = 7 * 86_400;

export type WebhookDeliveryRecord = {
  deliveryId: string;
  event: string;
  action?: string;
  status: WebhookDeliveryStatus;
  /** Why an event was ignored or how it was handled, e.g. `unsupported_event`, `job_enqueued`. */
  reason?: string;
  error?: string;
  /** 1 on first receipt; incremented each time a failed or stale delivery is reclaimed. */
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
};

const webhookDeliverySchema = new Schema<WebhookDeliveryRecord>(
  {
    deliveryId: { type: String, required: true },
    event: { type: String, required: true },
    action: { type: String },
    status: { type: String, enum: WEBHOOK_DELIVERY_STATUSES, required: true },
    reason: { type: String },
    error: { type: String },
    attempts: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, collection: 'webhookDeliveries' },
);

webhookDeliverySchema.index({ deliveryId: 1 }, { unique: true });
webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: WEBHOOK_DELIVERY_TTL_SECONDS });

export const WebhookDeliveryModel = defineModel('WebhookDelivery', webhookDeliverySchema);
