import { z } from 'zod';

import { ValidationError } from '../errors.js';

// Opaque cursors for keyset pagination (Architecture.md §5): base64url of `{ k, id }`, where
// `k` is the sort key of the last row returned and `id` its _id (the tie-breaker).

const MAX_CURSOR_LENGTH = 512;

export const CursorPayloadSchema = z.object({
  k: z.union([z.string().max(300), z.number()]),
  id: z.string().regex(/^[a-f0-9]{24}$/),
});
export type CursorPayload = z.infer<typeof CursorPayloadSchema>;

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Throws `ValidationError` (400) for anything that is not a cursor this API issued. */
export function decodeCursor(cursor: string): CursorPayload {
  const invalid = () =>
    new ValidationError('Invalid cursor', [{ path: 'cursor', message: 'not a valid cursor' }]);
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const result = CursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid();
  }
  return result.data;
}
