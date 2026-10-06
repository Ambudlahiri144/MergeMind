import { describe, expect, it } from 'vitest';

import { ValidationError } from '../errors.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const ID = '66f0a1b2c3d4e5f601234567';

describe('cursor', () => {
  it('round-trips a sort key and id', () => {
    const cursor = encodeCursor({ k: '2026-10-06T10:00:00.000Z', id: ID });

    expect(decodeCursor(cursor)).toEqual({ k: '2026-10-06T10:00:00.000Z', id: ID });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it.each([
    ['not base64 json', 'not-a-cursor'],
    ['wrong shape', Buffer.from(JSON.stringify({ k: 1 })).toString('base64url')],
    ['bad id', Buffer.from(JSON.stringify({ k: 1, id: 'x' })).toString('base64url')],
    ['too long', 'a'.repeat(600)],
  ])('rejects %s with a 400', (_label, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(ValidationError);
  });
});
