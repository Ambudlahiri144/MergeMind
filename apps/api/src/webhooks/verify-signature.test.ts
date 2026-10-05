import { signWebhookBody } from '@mergemind/shared/testing';
import { describe, expect, it } from 'vitest';

import { isValidWebhookSignature } from './verify-signature.js';

const SECRET = 'webhook-secret-for-tests';
const BODY = '{"action":"opened","number":42}';

describe('isValidWebhookSignature', () => {
  it('accepts the signature GitHub would send', () => {
    expect(isValidWebhookSignature(Buffer.from(BODY), signWebhookBody(BODY, SECRET), SECRET)).toBe(
      true,
    );
  });

  it('rejects a signature made with another secret', () => {
    const signature = signWebhookBody(BODY, 'some-other-secret');

    expect(isValidWebhookSignature(Buffer.from(BODY), signature, SECRET)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const signature = signWebhookBody(BODY, SECRET);

    expect(isValidWebhookSignature(Buffer.from(`${BODY} `), signature, SECRET)).toBe(false);
  });

  it.each([
    ['missing header', undefined],
    ['repeated header', ['sha256=aa', 'sha256=bb']],
    ['sha1 prefix', `sha1=${'a'.repeat(40)}`],
    ['no prefix', 'a'.repeat(64)],
    ['too short', 'sha256=abcd'],
    ['not hex', `sha256=${'z'.repeat(64)}`],
  ])('rejects a %s', (_label, header) => {
    expect(isValidWebhookSignature(Buffer.from(BODY), header, SECRET)).toBe(false);
  });
});
