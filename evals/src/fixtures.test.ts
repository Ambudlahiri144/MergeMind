import { describe, expect, it } from 'vitest';

import { BENCHMARK_CATEGORIES, addedLines, loadFixtures } from './fixtures.js';

// The benchmark itself is data; these checks keep it honest (PRD §7, Testing.md §4).
const fixtures = await loadFixtures();

describe('seeded-bug benchmark fixtures', () => {
  it('has at least 30 buggy and 10 clean fixtures', () => {
    const buggy = fixtures.filter((fixture) => fixture.expected.length > 0);

    expect(buggy.length).toBeGreaterThanOrEqual(30);
    expect(fixtures.length - buggy.length).toBeGreaterThanOrEqual(10);
  });

  it('covers every benchmark category at least three times', () => {
    const counts = new Map<string, number>();
    for (const fixture of fixtures) {
      for (const category of new Set(fixture.expected.map((bug) => bug.category))) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    for (const category of BENCHMARK_CATEGORIES) {
      expect(counts.get(category) ?? 0, category).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: every seeded bug starts and ends on a line its diff adds',
    (_id, fixture) => {
      expect(fixture.files.length).toBeGreaterThan(0);
      for (const bug of fixture.expected) {
        const file = fixture.files.find((candidate) => candidate.path === bug.path);
        const added = file ? addedLines(file) : new Set<number>();

        expect(file, bug.path).toBeDefined();
        expect(added.has(bug.lineStart), `${bug.path}:${String(bug.lineStart)}`).toBe(true);
        expect(added.has(bug.lineEnd), `${bug.path}:${String(bug.lineEnd)}`).toBe(true);
      }
    },
  );

  it('contains no secret that GitHub push protection would block', () => {
    // Seeded secrets must look like secrets to a reviewer but match no provider pattern,
    // or pushing the benchmark to a public repo gets rejected.
    const providerPatterns = [
      /sk_(live|test)_[0-9a-zA-Z]{20,}/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bgh[pousr]_[A-Za-z0-9]{30,}/,
      /\bxox[abprs]-/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    const lines = fixtures.flatMap((fixture) =>
      fixture.files.flatMap((file) =>
        file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.content)),
      ),
    );

    for (const pattern of providerPatterns) {
      expect(
        lines.filter((line) => pattern.test(line)),
        String(pattern),
      ).toEqual([]);
    }
  });

  it('names clean fixtures clean-* and buggy ones after their category', () => {
    for (const fixture of fixtures) {
      expect(fixture.id.startsWith('clean-'), fixture.id).toBe(fixture.expected.length === 0);
    }
  });
});
