import { describe, expect, it } from 'vitest';

import {
  isFindingMatch,
  matchFixture,
  rangesOverlap,
  type ExpectedLocated,
  type LocatedFinding,
  type ReportedFinding,
} from './match.js';

const expected: LocatedFinding = {
  path: 'src/users.ts',
  lineStart: 10,
  lineEnd: 14,
  category: 'injection',
};

function report(overrides: Partial<ReportedFinding> = {}): ReportedFinding {
  return {
    ...expected,
    lineStart: 12,
    lineEnd: 12,
    severity: 'critical',
    pass: 'security',
    title: 'SQL injection',
    confidence: 0.9,
    ...overrides,
  };
}

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

  it('treats unchecked input on the same lines as the injection (ADR-021 family)', () => {
    expect(isFindingMatch({ ...expected, category: 'unchecked-input' }, expected)).toBe(true);
  });

  it('rejects a different path', () => {
    expect(isFindingMatch({ ...expected, path: 'src/orders.ts' }, expected)).toBe(false);
  });

  it('rejects a different category', () => {
    expect(isFindingMatch({ ...expected, category: 'null-deref' }, expected)).toBe(false);
  });
});

describe('matchFixture', () => {
  const bug: ExpectedLocated = { ...expected, severity: 'critical' };

  it('lets one bug take one report: a restatement is left unmatched', () => {
    const match = matchFixture(
      [report({ severity: 'major', pass: 'correctness' }), report()],
      [bug],
    );

    expect(match.pairs).toEqual([{ expected: 0, reported: 1 }]);
    expect(match.unmatchedReported).toEqual([0]);
    expect(match.unmatchedExpected).toEqual([]);
  });

  it('reports a missed bug and an unrelated finding', () => {
    const match = matchFixture([report({ path: 'src/other.ts' })], [bug]);

    expect(match.pairs).toEqual([]);
    expect(match.unmatchedReported).toEqual([0]);
    expect(match.unmatchedExpected).toEqual([0]);
  });
});
