import { describe, expect, it } from 'vitest';

import { isFindingMatch, rangesOverlap, type LocatedFinding } from './match.js';

const expected: LocatedFinding = {
  path: 'src/users.ts',
  lineStart: 10,
  lineEnd: 14,
  category: 'injection',
};

describe('rangesOverlap', () => {
  it.each([
    [{ lineStart: 14, lineEnd: 20 }, true],
    [{ lineStart: 1, lineEnd: 10 }, true],
    [{ lineStart: 11, lineEnd: 12 }, true],
    [{ lineStart: 15, lineEnd: 20 }, false],
    [{ lineStart: 1, lineEnd: 9 }, false],
  ])('treats %o against 10-14 as overlap=%s', (range, isOverlap) => {
    expect(rangesOverlap(range, expected)).toBe(isOverlap);
  });
});

describe('isFindingMatch', () => {
  it('matches on same path, overlapping lines and same category', () => {
    expect(isFindingMatch({ ...expected, lineStart: 12, lineEnd: 12 }, expected)).toBe(true);
  });

  it('rejects a different path', () => {
    expect(isFindingMatch({ ...expected, path: 'src/orders.ts' }, expected)).toBe(false);
  });

  it('rejects a different category', () => {
    expect(isFindingMatch({ ...expected, category: 'null-deref' }, expected)).toBe(false);
  });
});
