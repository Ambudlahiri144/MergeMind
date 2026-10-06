import { describe, expect, it } from 'vitest';

import { splitUnifiedDiff } from './patch.js';

const DIFF = [
  'diff --git a/src/users.ts b/src/users.ts',
  'index 1111111..2222222 100644',
  '--- a/src/users.ts',
  '+++ b/src/users.ts',
  '@@ -1,2 +1,3 @@',
  ' import { db } from "./db";',
  '+export const find = (id: string) => db.query(`SELECT * FROM u WHERE id = ${id}`);',
  ' export {};',
  'diff --git a/src/new.py b/src/new.py',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/new.py',
  '@@ -0,0 +1,2 @@',
  '+def f():',
  '+    return 1',
  '',
].join('\n');

describe('splitUnifiedDiff', () => {
  it('splits a multi-file git diff into per-file patches with counts and status', () => {
    const files = splitUnifiedDiff(DIFF);

    expect(
      files.map((file) => [file.filename, file.status, file.additions, file.deletions]),
    ).toEqual([
      ['src/users.ts', 'modified', 1, 0],
      ['src/new.py', 'added', 2, 0],
    ]);
    expect(files[0]?.patch?.startsWith('@@ -1,2 +1,3 @@')).toBe(true);
    expect(files[1]?.patch?.endsWith('+    return 1')).toBe(true);
  });

  it('keeps the old path of a rename', () => {
    const files = splitUnifiedDiff(
      [
        'diff --git a/old.ts b/new.ts',
        'similarity index 90%',
        'rename from old.ts',
        'rename to new.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ].join('\n'),
    );

    expect(files[0]).toMatchObject({
      filename: 'new.ts',
      previous_filename: 'old.ts',
      status: 'renamed',
    });
  });

  it('ignores text before the first file header', () => {
    expect(splitUnifiedDiff('From abc\nSubject: x\n')).toEqual([]);
  });
});
