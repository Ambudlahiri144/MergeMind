import type { FindingView } from '@mergemind/db';
import { toFileDiff } from '@mergemind/github';
import { describe, expect, it } from 'vitest';

import {
  changedHeadLines,
  currentIssueRegions,
  findResolvedFindings,
  isFindingTouched,
  mapOldLineToNew,
  scopeToChanges,
} from './incremental.js';

const diff = (filename: string, patch: string, status = 'modified', previous?: string) =>
  toFileDiff({
    filename,
    status,
    additions: 0,
    deletions: 0,
    patch,
    ...(previous === undefined ? {} : { previous_filename: previous }),
  });

// last reviewed → head: line 2 rewritten, a line inserted after old line 5.
const COMPARE = diff(
  'src/b.ts',
  [
    '@@ -1,3 +1,3 @@',
    ' function save(x) {',
    '-  db.insert(x);',
    '+  await db.insert(x);',
    ' }',
    '@@ -5,0 +6,2 @@',
    '+// new',
    '+// lines',
  ].join('\n'),
);

function finding(overrides: Partial<FindingView> = {}): FindingView {
  return {
    id: 'f1',
    reviewRunId: 'run-1',
    pass: 'correctness',
    severity: 'major',
    confidence: 0.9,
    category: 'missing-await',
    path: 'src/b.ts',
    lineStart: 2,
    lineEnd: 2,
    title: 'Missing await',
    body: 'b',
    suggestion: null,
    fingerprint: 'fp-old',
    state: 'open',
    placement: 'inline',
    githubCommentId: 99,
    ...overrides,
  };
}

describe('changedHeadLines', () => {
  it('collects added head lines per file', () => {
    expect([...(changedHeadLines([COMPARE]).get('src/b.ts') ?? [])]).toEqual([2, 6, 7]);
  });

  it('uses context lines for a deletion-only hunk', () => {
    const deletion = diff('src/c.ts', '@@ -3,3 +3,2 @@\n keep\n-gone\n tail');

    expect([...(changedHeadLines([deletion]).get('src/c.ts') ?? [])]).toEqual([3, 4]);
  });

  it('ignores removed files', () => {
    expect(changedHeadLines([diff('src/old.ts', '@@ -1 +0,0 @@\n-x', 'removed')]).size).toBe(0);
  });
});

describe('scopeToChanges', () => {
  it('keeps only PR-diff hunks containing a changed line', () => {
    const prFile = diff(
      'src/b.ts',
      [
        '@@ -0,0 +1,3 @@',
        '+function save(x) {',
        '+  await db.insert(x);',
        '+}',
        '@@ -10,1 +12,1 @@',
        '-a',
        '+b',
      ].join('\n'),
    );
    const untouched = diff('src/a.ts', '@@ -0,0 +1,1 @@\n+const a = 1;');

    const scoped = scopeToChanges([prFile, untouched], new Map([['src/b.ts', new Set([2])]]));

    expect(scoped.map((f) => [f.path, f.hunks.length])).toEqual([['src/b.ts', 1]]);
  });
});

describe('mapOldLineToNew', () => {
  it.each([
    [1, 1],
    [2, 2], // rewritten line maps to its replacement
    [4, 4],
    [5, 5],
    [6, 8], // below the 2-line insertion
  ])('maps old line %i to new line %i', (oldLine, newLine) => {
    expect(mapOldLineToNew(COMPARE, oldLine)).toBe(newLine);
  });

  it('maps a deleted line to the nearest surviving line', () => {
    const deletion = diff('src/c.ts', '@@ -3,3 +3,2 @@\n keep\n-gone\n tail');

    expect(mapOldLineToNew(deletion, 4)).toBe(4);
  });
});

describe('isFindingTouched', () => {
  it('is true when a line in the range was rewritten', () => {
    expect(isFindingTouched(finding(), COMPARE)).toBe(true);
  });

  it('is true when lines were inserted inside the range', () => {
    expect(isFindingTouched(finding({ lineStart: 4, lineEnd: 6 }), COMPARE)).toBe(true);
  });

  it('is false for code the push did not change', () => {
    expect(isFindingTouched(finding({ lineStart: 3, lineEnd: 4 }), COMPARE)).toBe(false);
  });

  it('is true for a deleted file', () => {
    expect(isFindingTouched(finding(), diff('src/b.ts', '@@ -1 +0,0 @@\n-x', 'removed'))).toBe(
      true,
    );
  });
});

describe('findResolvedFindings', () => {
  it('resolves a touched finding nobody reports any more', () => {
    expect(
      findResolvedFindings({
        openFindings: [finding()],
        compareFiles: [COMPARE],
        currentIssues: [],
      }),
    ).toEqual([finding()]);
  });

  it('keeps a touched finding the new review still reports at its new position', () => {
    const stillThere = {
      path: 'src/b.ts',
      category: 'missing-await' as const,
      lineStart: 2,
      lineEnd: 2,
      fingerprint: 'fp-new',
    };

    expect(
      findResolvedFindings({
        openFindings: [finding()],
        compareFiles: [COMPARE],
        currentIssues: [stillThere],
      }),
    ).toEqual([]);
  });

  it('never resolves an untouched finding, even if not re-reported', () => {
    const untouched = finding({ path: 'src/a.ts' });

    expect(
      findResolvedFindings({
        openFindings: [untouched],
        compareFiles: [COMPARE],
        currentIssues: [],
      }),
    ).toEqual([]);
  });

  it('follows a rename and resolves a deleted file', () => {
    const renamed = diff(
      'src/renamed.ts',
      [
        '@@ -1,3 +1,3 @@',
        ' function save(x) {',
        '-  db.insert(x);',
        '+  await db.insert(x);',
        ' }',
      ].join('\n'),
      'renamed',
      'src/b.ts',
    );
    const deleted = diff('src/gone.ts', '@@ -1 +0,0 @@\n-x', 'removed');

    const resolved = findResolvedFindings({
      openFindings: [finding(), finding({ id: 'f2', path: 'src/gone.ts' })],
      compareFiles: [renamed, deleted],
      currentIssues: [],
    });

    expect(resolved.map((f) => f.id)).toEqual(['f1', 'f2']);
  });
});

describe('currentIssueRegions', () => {
  it('moves open findings to their head-side lines and drops deleted files', () => {
    const below = finding({ id: 'f2', lineStart: 7, lineEnd: 8 });
    const untouched = finding({ id: 'f3', path: 'src/a.ts', lineStart: 4, lineEnd: 4 });
    const gone = finding({ id: 'f4', path: 'src/gone.ts' });
    const deleted = diff('src/gone.ts', '@@ -1 +0,0 @@\n-x', 'removed');

    const regions = currentIssueRegions([below, untouched, gone], [COMPARE, deleted]);

    expect(regions).toEqual([
      { path: 'src/b.ts', category: 'missing-await', lineStart: 9, lineEnd: 10 },
      { path: 'src/a.ts', category: 'missing-await', lineStart: 4, lineEnd: 4 },
    ]);
  });
});
