import { z } from 'zod';

export const GITHUB_EVENT_HEADER = 'x-github-event';
export const GITHUB_DELIVERY_HEADER = 'x-github-delivery';
export const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';

const MAX_EVENT_NAME_LENGTH = 64;
const MAX_DELIVERY_ID_LENGTH = 128;

/** The signature header is checked separately (401, not 400) by the HMAC verifier. */
export const WebhookHeadersSchema = z.object({
  [GITHUB_EVENT_HEADER]: z
    .string()
    .max(MAX_EVENT_NAME_LENGTH)
    .regex(/^[a-z_]+$/, 'must be a GitHub event name'),
  [GITHUB_DELIVERY_HEADER]: z
    .string()
    .max(MAX_DELIVERY_ID_LENGTH)
    .regex(/^[A-Za-z0-9-]+$/, 'must be a delivery GUID'),
});

export type WebhookHeaders = z.infer<typeof WebhookHeadersSchema>;
