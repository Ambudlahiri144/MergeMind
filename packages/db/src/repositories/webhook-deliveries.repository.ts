import type { WebhookDeliveryStatus } from '@mergemind/shared';

import { isDuplicateKeyError } from '../models/define-model.js';
import { WebhookDeliveryModel } from '../models/webhook-delivery.model.js';

/** A `received` row this old belongs to a request that crashed mid-handling; let it be reclaimed. */
export const STALE_CLAIM_MS = 5 * 60_000;

export type ClaimDeliveryInput = {
  deliveryId: string;
  event: string;
  action?: string;
};

export type DeliveryClaim =
  { isClaimed: true; attempt: number } | { isClaimed: false; status: WebhookDeliveryStatus };

export type FinalDeliveryStatus = Exclude<WebhookDeliveryStatus, 'received'>;

export type WebhookDeliveryView = {
  deliveryId: string;
  event: string;
  action?: string;
  status: WebhookDeliveryStatus;
  reason?: string;
  error?: string;
  attempts: number;
};

export type WebhookDeliveriesRepository = {
  /**
   * Records a delivery exactly once (idempotent consumer, Architecture.md §3). A redelivery of a
   * `failed` or stale `received` delivery is reclaimed so GitHub's "Redeliver" button works.
   */
  claim(input: ClaimDeliveryInput, now?: Date): Promise<DeliveryClaim>;
  markStatus(
    deliveryId: string,
    status: FinalDeliveryStatus,
    details?: { reason?: string; error?: string },
  ): Promise<void>;
  findByDeliveryId(deliveryId: string): Promise<WebhookDeliveryView | null>;
};

const VIEW_PROJECTION = {
  _id: 0,
  deliveryId: 1,
  event: 1,
  action: 1,
  status: 1,
  reason: 1,
  error: 1,
  attempts: 1,
} as const;

export function createWebhookDeliveriesRepository(): WebhookDeliveriesRepository {
  return {
    async claim({ deliveryId, event, action }, now = new Date()) {
      const fields = { deliveryId, event, ...(action === undefined ? {} : { action }) };
      try {
        await WebhookDeliveryModel.create({ ...fields, status: 'received', attempts: 1 });
        return { isClaimed: true, attempt: 1 };
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
      }

      const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
      const reclaimed = await WebhookDeliveryModel.findOneAndUpdate(
        {
          deliveryId,
          $or: [{ status: 'failed' }, { status: 'received', updatedAt: { $lt: staleBefore } }],
        },
        { $set: { status: 'received' }, $unset: { error: 1, reason: 1 }, $inc: { attempts: 1 } },
        { returnDocument: 'after', projection: { attempts: 1 } },
      ).lean();
      if (reclaimed) {
        return { isClaimed: true, attempt: reclaimed.attempts };
      }

      const existing = await WebhookDeliveryModel.findOne({ deliveryId }, { status: 1 }).lean();
      return { isClaimed: false, status: existing?.status ?? 'received' };
    },

    async markStatus(deliveryId, status, details = {}) {
      await WebhookDeliveryModel.updateOne({ deliveryId }, { $set: { status, ...details } });
    },

    async findByDeliveryId(deliveryId) {
      return WebhookDeliveryModel.findOne(
        { deliveryId },
        VIEW_PROJECTION,
      ).lean<WebhookDeliveryView>();
    },
  };
}
