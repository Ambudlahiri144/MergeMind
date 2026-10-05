import type { FindingCategory } from '@mergemind/shared';

export type LocatedFinding = {
  path: string;
  lineStart: number;
  lineEnd: number;
  category: FindingCategory;
};

export function rangesOverlap(
  a: Pick<LocatedFinding, 'lineStart' | 'lineEnd'>,
  b: Pick<LocatedFinding, 'lineStart' | 'lineEnd'>,
): boolean {
  return a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;
}

/** A finding matches when path, overlapping line range and category all agree (Testing.md §4). */
export function isFindingMatch(actual: LocatedFinding, expected: LocatedFinding): boolean {
  return (
    actual.path === expected.path &&
    actual.category === expected.category &&
    rangesOverlap(actual, expected)
  );
}
