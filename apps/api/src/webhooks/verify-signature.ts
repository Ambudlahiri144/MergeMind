import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Checks GitHub's `X-Hub-Signature-256` against an HMAC-SHA256 of the raw body, in constant time
 * (rules.md §8). Must run before the body is parsed.
 */
export function isValidWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined,
  secret: string,
): boolean {
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  // Invalid hex decodes short, which the length check below rejects.
  const received = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
