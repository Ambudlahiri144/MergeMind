import type { Logger } from '@mergemind/shared/logger';
import type { GithubApp, WebhookDelivery } from '@mergemind/github';

/**
 * Redeliver App webhooks that never got a 2xx (ADR-038). On a host that sleeps or restarts, a
 * delivery can time out (GitHub waits 10 s) or hit a dying instance, and GitHub never retries
 * by itself. Once per boot the api asks GitHub to resend each such event; the delivery claim
 * (ADR-016) already accepts a GUID whose earlier attempt failed.
 */
export const REDELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_REDELIVERIES_PER_BOOT = 20;
/** A newer attempt may still be in flight; leave it alone. */
export const MIN_ATTEMPT_AGE_MS = 60_000;

const isSuccess = (statusCode: number) => statusCode >= 200 && statusCode < 300;

/**
 * Delivery ids to resend, oldest event first: for each GUID with no successful attempt, its
 * latest attempt, if that attempt is old enough to have finished.
 */
export function selectRedeliveries(deliveries: readonly WebhookDelivery[], now: Date): number[] {
  const byGuid = new Map<string, WebhookDelivery[]>();
  for (const delivery of deliveries) {
    const attempts = byGuid.get(delivery.guid) ?? [];
    attempts.push(delivery);
    byGuid.set(delivery.guid, attempts);
  }
  const picks: WebhookDelivery[] = [];
  for (const attempts of byGuid.values()) {
    if (attempts.some((attempt) => isSuccess(attempt.statusCode))) {
      continue;
    }
    const latest = attempts.reduce((newest, attempt) =>
      attempt.deliveredAt > newest.deliveredAt ? attempt : newest,
    );
    if (now.getTime() - latest.deliveredAt.getTime() >= MIN_ATTEMPT_AGE_MS) {
      picks.push(latest);
    }
  }
  return picks
    .sort((first, second) => first.deliveredAt.getTime() - second.deliveredAt.getTime())
    .slice(0, MAX_REDELIVERIES_PER_BOOT)
    .map((delivery) => delivery.id);
}

export type RedeliveryDeps = {
  github: Pick<GithubApp, 'listWebhookDeliveries' | 'redeliverWebhook'>;
  logger: Logger;
  now: () => Date;
};

export async function redeliverFailedWebhooks(
  deps: RedeliveryDeps,
): Promise<{ checked: number; redelivered: number; failed: number }> {
  const now = deps.now();
  const deliveries = await deps.github.listWebhookDeliveries(
    new Date(now.getTime() - REDELIVERY_WINDOW_MS),
  );
  const ids = selectRedeliveries(deliveries, now);
  let redelivered = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await deps.github.redeliverWebhook(id);
      redelivered += 1;
    } catch (error) {
      // One refused redelivery must not stop the others; it is logged and counted.
      failed += 1;
      deps.logger.warn({ err: error, deliveryId: id }, 'webhook.redeliveryFailed');
    }
  }
  const outcome = { checked: deliveries.length, redelivered, failed };
  deps.logger.info(outcome, 'webhook.redeliveryPass');
  return outcome;
}
