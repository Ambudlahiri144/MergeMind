import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  GITHUB_DELIVERY_HEADER,
  GITHUB_EVENT_HEADER,
  GITHUB_SIGNATURE_HEADER,
} from '../github/webhook-headers.js';

// Test and dev-script helpers. Never import this subpath from production code.

const FIXTURES_DIR = new URL('../../test/fixtures/github/', import.meta.url);

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

/** `sha256=<hex>` exactly as GitHub computes it over the raw body. */
export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export type GithubFixture = {
  event: string;
  payload: Record<string, unknown>;
};

/**
 * Loads `test/fixtures/github/<event>.<action>.json`, e.g. `pull_request.opened`.
 * The event name is the part before the first dot.
 */
export async function loadGithubFixture(name: string): Promise<GithubFixture> {
  const [event] = name.split('.');
  if (event === undefined || event === '') {
    throw new Error(`Invalid fixture name: ${name}`);
  }
  const text = await readFile(new URL(`${name}.json`, FIXTURES_DIR), 'utf8');
  return { event, payload: JSON.parse(text) as Record<string, unknown> };
}

export type SignedWebhook = {
  body: string;
  headers: Record<string, string>;
  deliveryId: string;
};

export function buildSignedWebhook(input: {
  event: string;
  payload: unknown;
  secret: string;
  deliveryId?: string;
}): SignedWebhook {
  const body = JSON.stringify(input.payload);
  const deliveryId = input.deliveryId ?? randomUUID();
  return {
    body,
    deliveryId,
    headers: {
      'content-type': 'application/json',
      [GITHUB_EVENT_HEADER]: input.event,
      [GITHUB_DELIVERY_HEADER]: deliveryId,
      [GITHUB_SIGNATURE_HEADER]: signWebhookBody(body, input.secret),
    },
  };
}
