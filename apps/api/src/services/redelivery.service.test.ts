import type { WebhookDelivery } from '@mergemind/github';
import { createLogger } from '@mergemind/shared/logger';
import { describe, expect, it } from 'vitest';

import {
  MAX_REDELIVERIES_PER_BOOT,
  redeliverFailedWebhooks,
  selectRedeliveries,
} from './redelivery.service.js';

const NOW = new Date('2026-10-08T12:00:00Z');

function attempt(
  id: number,
  guid: string,
  minutesAgo: number,
  statusCode: number,
): WebhookDelivery {
  return {
    id,
    guid,
    deliveredAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    statusCode,
    event: 'pull_request',
  };
}

describe('selectRedeliveries (ADR-038)', () => {
  it('resends the latest attempt of each event that never got a 2xx, oldest event first', () => {
    const ids = selectRedeliveries(
      [
        attempt(5, 'timed-out', 10, 0),
        attempt(4, 'retried-ok', 20, 202),
        attempt(3, 'retried-ok', 40, 502),
        attempt(2, 'failed-twice', 50, 503),
        attempt(1, 'failed-twice', 90, 0),
      ],
      NOW,
    );

    expect(ids).toEqual([2, 5]);
  });

  it('leaves an attempt younger than a minute alone (it may still be in flight)', () => {
    expect(selectRedeliveries([{ ...attempt(1, 'fresh', 0, 0) }], NOW)).toEqual([]);
  });

  it(`resends at most ${String(MAX_REDELIVERIES_PER_BOOT)} events per boot`, () => {
    const deliveries = Array.from({ length: 50 }, (_, index) =>
      attempt(index + 1, `guid-${String(index)}`, 5 + index, 500),
    );

    expect(selectRedeliveries(deliveries, NOW)).toHaveLength(MAX_REDELIVERIES_PER_BOOT);
  });
});

describe('redeliverFailedWebhooks', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });

  it('asks for the last 24 hours, resends the picks, and keeps going past one refusal', async () => {
    const asked: Date[] = [];
    const resent: number[] = [];
    const outcome = await redeliverFailedWebhooks({
      github: {
        listWebhookDeliveries: (since) => {
          asked.push(since);
          return Promise.resolve([attempt(7, 'a', 30, 0), attempt(8, 'b', 20, 500)]);
        },
        redeliverWebhook: (id) => {
          if (id === 7) {
            return Promise.reject(new Error('GitHub refused'));
          }
          resent.push(id);
          return Promise.resolve();
        },
      },
      logger,
      now: () => NOW,
    });

    expect(asked).toEqual([new Date('2026-10-07T12:00:00Z')]);
    expect(resent).toEqual([8]);
    expect(outcome).toEqual({ checked: 2, redelivered: 1, failed: 1 });
  });
});
