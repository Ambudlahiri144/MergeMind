import { describe, expect, it } from 'vitest';

import type { ExpectedLocated, ReportedFinding } from './match.js';
import { scoreFixture, summarize, type FixtureOutcome } from './metrics.js';

const BUG: ExpectedLocated = {
  path: 'src/a.ts',
  lineStart: 5,
  lineEnd: 5,
  category: 'missing-await',
  severity: 'major',
};

function report(overrides: Partial<ReportedFinding> = {}): ReportedFinding {
  return {
    path: 'src/a.ts',
    lineStart: 5,
    lineEnd: 5,
    category: 'missing-await',
    severity: 'major',
    pass: 'correctness',
    title: 'Not awaited',
    confidence: 0.9,
    ...overrides,
  };
}

function outcome(overrides: Partial<FixtureOutcome>): FixtureOutcome {
  return {
    id: 'x',
    category: 'missing-await',
    reported: [],
    expected: [BUG],
    isFailed: false,
    ...overrides,
  };
}

describe('scoreFixture (ADR-032)', () => {
  it('counts a match as TP, a stray major as FP and a stray minor as noise', () => {
    const score = scoreFixture(
      outcome({
        reported: [
          report(),
          report({ path: 'src/b.ts', category: 'null-deref' }),
          report({ path: 'src/b.ts', severity: 'minor', category: 'other' }),
        ],
      }),
    );

    expect(score).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
      minorNoise: 1,
    });
  });

  it('counts a missed blocking bug as FN, but a missed minor bug as nothing', () => {
    expect(scoreFixture(outcome({})).falseNegatives).toBe(1);
    expect(
      scoreFixture(outcome({ expected: [{ ...BUG, severity: 'minor' }] })).falseNegatives,
    ).toBe(0);
  });

  it('finds a bug reported only as minor (recall) without crediting precision', () => {
    const score = scoreFixture(outcome({ reported: [report({ severity: 'minor' })] }));

    expect(score).toMatchObject({ truePositives: 0, falseNegatives: 0, falsePositives: 0 });
  });
});

describe('summarize', () => {
  it('computes precision and recall, per-category recall and clean-fixture noise', () => {
    const summary = summarize([
      outcome({ id: 'a', reported: [report()] }),
      outcome({ id: 'b', reported: [] }),
      outcome({ id: 'clean', category: 'clean', expected: [], reported: [report()] }),
    ]);

    expect(summary.precision.value).toBeCloseTo(0.5);
    expect(summary.recall.value).toBeCloseTo(0.5);
    expect(summary.byCategory['missing-await']).toEqual({ expected: 2, found: 1 });
    expect(summary.cleanFixtureReports).toBe(1);
    expect(summary.isPassed).toBe(false);
  });

  it('keeps a seeded bug reported only as minor in the recall denominator, as found', () => {
    const summary = summarize([
      outcome({ id: 'a', reported: [report({ severity: 'minor' })] }),
      outcome({ id: 'b', reported: [] }),
      outcome({ id: 'c', expected: [{ ...BUG, severity: 'minor' }], reported: [report()] }),
    ]);

    // Seeded blocking bugs: a (found as minor) and b (missed); c's minor bug is not counted.
    expect(summary.recall.value).toBeCloseTo(0.5);
    expect(summary.precision.value).toBe(1);
  });

  it('never passes when fixtures failed, and leaves them out of the scores', () => {
    const summary = summarize([
      outcome({ id: 'a', reported: [report()] }),
      outcome({ id: 'b', isFailed: true }),
    ]);

    expect(summary.failedFixtures).toBe(1);
    expect(summary.recall.value).toBe(1);
    expect(summary.isPassed).toBe(false);
  });
});
