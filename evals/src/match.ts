import type { FindingCategory, Severity } from '@mergemind/shared';

export type LocatedFinding = {
  path: string;
  lineStart: number;
  lineEnd: number;
  category: FindingCategory;
};

export type ReportedFinding = LocatedFinding & {
  severity: Severity;
  pass: string;
  title: string;
  confidence: number;
};

export type ExpectedLocated = LocatedFinding & { severity: Severity };

/**
 * Categories that name one bug from two sides: unchecked input flowing into a query is the
 * injection (the same family the review pipeline merges on, ADR-021).
 */
const CATEGORY_FAMILY: Partial<Record<FindingCategory, string>> = {
  injection: 'tainted-input',
  'unchecked-input': 'tainted-input',
};

function family(category: FindingCategory): string {
  return CATEGORY_FAMILY[category] ?? category;
}

export function rangesOverlap(
  a: Pick<LocatedFinding, 'lineStart' | 'lineEnd'>,
  b: Pick<LocatedFinding, 'lineStart' | 'lineEnd'>,
): boolean {
  return a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;
}

/**
 * A finding matches when the path is the same, the line ranges overlap and the category is the
 * same or in the same family (Testing.md §4, ADR-032).
 */
export function isFindingMatch(actual: LocatedFinding, expected: LocatedFinding): boolean {
  return (
    actual.path === expected.path &&
    family(actual.category) === family(expected.category) &&
    rangesOverlap(actual, expected)
  );
}

export type FixtureMatch = {
  /** Pairs of (expected index, reported index). */
  pairs: { expected: number; reported: number }[];
  unmatchedReported: number[];
  unmatchedExpected: number[];
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

/**
 * One-to-one matching within a fixture: each expected bug takes at most one report (the most
 * severe, then most confident, matching one), so a bug restated twice counts once and the
 * restatement is a false positive.
 */
export function matchFixture(
  reported: readonly ReportedFinding[],
  expected: readonly ExpectedLocated[],
): FixtureMatch {
  const order = reported
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] ||
        b.finding.confidence - a.finding.confidence,
    );
  const taken = new Set<number>();
  const pairs: FixtureMatch['pairs'] = [];
  expected.forEach((bug, expectedIndex) => {
    const match = order.find(
      ({ finding, index }) => !taken.has(index) && isFindingMatch(finding, bug),
    );
    if (match) {
      taken.add(match.index);
      pairs.push({ expected: expectedIndex, reported: match.index });
    }
  });
  const matchedExpected = new Set(pairs.map((pair) => pair.expected));
  return {
    pairs,
    unmatchedReported: reported.map((_, index) => index).filter((index) => !taken.has(index)),
    unmatchedExpected: expected
      .map((_, index) => index)
      .filter((index) => !matchedExpected.has(index)),
  };
}
