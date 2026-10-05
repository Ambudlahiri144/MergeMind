import { describe, expect, it } from 'vitest';

import { anchorFinding } from './anchor.js';
import {
  commentableLines,
  countChangedLines,
  headCodeInRange,
  parsePatch,
  toFileDiff,
} from './diff-parser.js';

const PATCH = [
  '@@ -10,4 +10,5 @@ export function findUser(id) {',
  ' const db = getDb();',
  '-const row = db.query("SELECT * FROM users WHERE id = " + id);',
  '+const sql = `SELECT * FROM users WHERE id = ${id}`;',
  '+const row = db.query(sql);',
  ' if (!row) return null;',
  ' return row;',
  '@@ -40 +41,2 @@',
  '-old',
  '+new one',
  '+new two',
  '\\ No newline at end of file',
].join('\n');

describe('parsePatch', () => {
  it('tracks base- and head-side line numbers per hunk', () => {
    const [first, second] = parsePatch(PATCH);

    expect(first).toMatchObject({ oldStart: 10, oldLines: 4, newStart: 10, newLines: 5 });
    expect(first?.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['context', 10, 10],
      ['removed', 11, null],
      ['added', null, 11],
      ['added', null, 12],
      ['context', 12, 13],
      ['context', 13, 14],
    ]);
    expect(second).toMatchObject({ oldStart: 40, oldLines: 1, newStart: 41, newLines: 2 });
  });

  it('skips the no-newline marker', () => {
    const second = parsePatch(PATCH)[1];

    expect(second?.lines.map((line) => line.content)).toEqual(['old', 'new one', 'new two']);
  });

  it('returns no hunks for an empty patch', () => {
    expect(parsePatch('')).toEqual([]);
  });

  it('keeps an empty context line (a single space) as a line', () => {
    const [hunk] = parsePatch('@@ -1,3 +1,3 @@\n a\n \n-b\n+c');

    expect(hunk?.lines.map((line) => line.kind)).toEqual([
      'context',
      'context',
      'removed',
      'added',
    ]);
  });
});

describe('toFileDiff', () => {
  it('maps a renamed file with a patch', () => {
    const file = toFileDiff({
      filename: 'src/new.ts',
      previous_filename: 'src/old.ts',
      status: 'renamed',
      additions: 3,
      deletions: 1,
      patch: PATCH,
    });

    expect(file).toMatchObject({
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
      hasPatch: true,
    });
    expect(file.hunks).toHaveLength(2);
  });

  it('marks a binary file (no patch) as not reviewable', () => {
    const file = toFileDiff({ filename: 'logo.png', status: 'added', additions: 0, deletions: 0 });

    expect(file).toMatchObject({ hasPatch: false, hunks: [], previousPath: null });
  });

  it('treats an unknown status as modified', () => {
    expect(
      toFileDiff({ filename: 'a', status: 'mystery', additions: 0, deletions: 0 }).status,
    ).toBe('modified');
  });
});

describe('commentableLines, headCodeInRange, countChangedLines', () => {
  const file = toFileDiff({
    filename: 'src/users.ts',
    status: 'modified',
    additions: 4,
    deletions: 2,
    patch: PATCH,
  });

  it('maps added and context head lines to their hunk, never removed lines', () => {
    expect([...commentableLines(file).entries()]).toEqual([
      [10, 0],
      [11, 0],
      [12, 0],
      [13, 0],
      [14, 0],
      [41, 1],
      [42, 1],
    ]);
  });

  it('extracts head-side code for a range', () => {
    expect(headCodeInRange(file, 11, 12)).toBe(
      'const sql = `SELECT * FROM users WHERE id = ${id}`;\nconst row = db.query(sql);',
    );
  });

  it('sums additions and deletions', () => {
    expect(countChangedLines([file, file])).toBe(12);
  });
});

describe('anchorFinding', () => {
  const lines = commentableLines(
    toFileDiff({ filename: 'a.ts', status: 'modified', additions: 4, deletions: 2, patch: PATCH }),
  );

  it.each([
    ['a single commentable line', { lineStart: 11, lineEnd: 11 }, { line: 11 }],
    ['a range inside one hunk', { lineStart: 11, lineEnd: 13 }, { line: 13, startLine: 11 }],
    ['a range spanning two hunks', { lineStart: 13, lineEnd: 41 }, { line: 41 }],
    ['a range ending outside the diff', { lineStart: 14, lineEnd: 20 }, { line: 14 }],
    ['a range with only a middle line in the diff', { lineStart: 40, lineEnd: 43 }, { line: 41 }],
  ])('anchors %s', (_label, range, expected) => {
    expect(anchorFinding(range, lines)).toEqual(expected);
  });

  it('returns null for a range entirely outside the diff', () => {
    expect(anchorFinding({ lineStart: 100, lineEnd: 120 }, lines)).toBeNull();
  });
});
