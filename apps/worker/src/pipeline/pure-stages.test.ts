import { toFileDiff } from '@mergemind/github';
import type { CandidateFinding, FileDiff } from '@mergemind/shared';
import { describe, expect, it } from 'vitest';

import { chunkFiles } from './chunk-hunks.js';
import { classifyFindings, gateSeverities, prepareFindings } from './post-process.js';

const PATCH = [
  '@@ -1,3 +1,5 @@',
  ' import { db } from "./db";',
  '+const sql = "SELECT * FROM t WHERE id = " + id;',
  '+const rows = db.query(sql);',
  ' export {};',
  ' // end',
].join('\n');

const file = toFileDiff({
  filename: 'src/a.ts',
  status: 'modified',
  additions: 2,
  deletions: 0,
  patch: PATCH,
});
const filesByPath = new Map<string, FileDiff>([[file.path, file]]);

function candidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    pass: 'security',
    severity: 'critical',
    confidence: 0.9,
    category: 'injection',
    path: 'src/a.ts',
    lineStart: 2,
    lineEnd: 3,
    title: 'SQL injection',
    body: 'Concatenated SQL.',
    suggestion: null,
    ...overrides,
  };
}

describe('chunkFiles', () => {
  const bigLine = 'x'.repeat(400);
  const bigPatch = ['@@ -1,0 +1,30 @@', ...Array.from({ length: 30 }, () => `+${bigLine}`)].join(
    '\n',
  );
  const big = toFileDiff({
    filename: 'src/big.ts',
    status: 'added',
    additions: 30,
    deletions: 0,
    patch: bigPatch,
  });

  it('keeps small files together in one chunk', () => {
    const chunks = chunkFiles([file, { ...file, path: 'src/b.ts' }], 6000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('splits an oversized hunk only between lines and keeps every line once', () => {
    const chunks = chunkFiles([big], 1000);

    const lines = chunks.flatMap((chunk) =>
      chunk.files.flatMap((f) => f.hunks.flatMap((h) => h.lines)),
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 1000)).toBe(true);
    expect(lines.map((line) => line.newLine)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe('prepareFindings', () => {
  it('drops findings on files outside the diff', () => {
    const { prepared, droppedCount } = prepareFindings(
      [candidate({ path: 'src/hallucinated.ts' })],
      filesByPath,
    );

    expect(prepared).toEqual([]);
    expect(droppedCount).toBe(1);
  });

  it('anchors, fingerprints, and keeps the strongest of duplicate findings', () => {
    const { prepared } = prepareFindings(
      [candidate({ severity: 'major', confidence: 0.8 }), candidate({ title: 'SQL Injection!' })],
      filesByPath,
    );

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ severity: 'critical', anchor: { line: 3, startLine: 2 } });
    expect(prepared[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives an outside-diff finding a null anchor', () => {
    const { prepared } = prepareFindings([candidate({ lineStart: 50, lineEnd: 52 })], filesByPath);

    expect(prepared[0]?.anchor).toBeNull();
  });
});

describe('classifyFindings', () => {
  const options = {
    suppressed: new Set<string>(),
    alreadyReported: new Set<string>(),
    minConfidence: 0.7,
    maxInlineComments: 25,
  };

  it('places critical/major inline, minor and outside-diff in the body', () => {
    const { prepared } = prepareFindings(
      [
        candidate(),
        candidate({ severity: 'minor', title: 'Name', category: 'other', pass: 'maintainability' }),
        candidate({
          severity: 'major',
          lineStart: 90,
          lineEnd: 90,
          title: 'Far away',
          pass: 'correctness',
        }),
      ],
      filesByPath,
    );

    const { toStore, counts } = classifyFindings(prepared, options);

    expect(toStore.map((f) => [f.title, f.placement, f.state])).toEqual([
      ['SQL injection', 'inline', 'open'],
      ['Far away', 'summary', 'open'],
      ['Name', 'summary', 'open'],
    ]);
    expect(counts).toMatchObject({ critical: 1, major: 1, minor: 1 });
  });

  it('filters low confidence, skips suppressed, and counts already reported toward the gate', () => {
    const { prepared } = prepareFindings(
      [
        candidate({ title: 'Low', confidence: 0.4, category: 'swallowed-error' }),
        candidate({ title: 'Suppressed', category: 'hardcoded-secret' }),
        candidate({ title: 'Old one', category: 'unchecked-input' }),
      ],
      filesByPath,
    );
    const fingerprintOf = (title: string) =>
      prepared.find((f) => f.title === title)?.fingerprint ?? '';

    const { toStore, counts } = classifyFindings(prepared, {
      ...options,
      suppressed: new Set([fingerprintOf('Suppressed')]),
      alreadyReported: new Set([fingerprintOf('Old one')]),
    });

    expect(toStore.map((f) => [f.title, f.state])).toEqual([['Low', 'filtered']]);
    expect(counts).toEqual({
      critical: 1,
      major: 0,
      minor: 0,
      suppressed: 1,
      filtered: 1,
      duplicate: 1,
      merged: 0,
    });
    expect(gateSeverities(counts)).toEqual([{ severity: 'critical' }]);
  });

  describe('cross-pass merge (ADR-021)', () => {
    // The live run on 2026-10-06 reported the same SQL injection from two passes.
    const securityCritical = candidate({ title: 'SQL injection via concatenation' });
    const correctnessMajor = candidate({
      pass: 'correctness',
      severity: 'major',
      confidence: 0.85,
      lineStart: 3,
      lineEnd: 3,
      title: 'SQL injection risk in user query',
    });

    it('keeps the most severe report of one issue and counts the rest as merged', () => {
      const { prepared } = prepareFindings([correctnessMajor, securityCritical], filesByPath);

      const { toStore, counts } = classifyFindings(prepared, options);

      expect(toStore.map((f) => [f.pass, f.severity, f.title])).toEqual([
        ['security', 'critical', 'SQL injection via concatenation'],
      ]);
      expect(counts).toMatchObject({ critical: 1, major: 0, merged: 1 });
    });

    it('merges within the line tolerance but not further away', () => {
      const near = candidate({ pass: 'correctness', lineStart: 5, lineEnd: 5, title: 'Near' });
      const far = candidate({ pass: 'correctness', lineStart: 9, lineEnd: 9, title: 'Far' });
      const { prepared } = prepareFindings([securityCritical, near, far], filesByPath);

      const { toStore } = classifyFindings(prepared, options);

      expect(toStore.map((f) => f.title)).toEqual(['SQL injection via concatenation', 'Far']);
    });

    it('never merges different categories or the catch-all "other"', () => {
      const otherA = candidate({
        pass: 'maintainability',
        severity: 'minor',
        category: 'other',
        title: 'A',
      });
      const otherB = candidate({
        pass: 'correctness',
        severity: 'minor',
        category: 'other',
        title: 'B',
      });
      const secret = candidate({ category: 'hardcoded-secret', title: 'Key in source' });
      const { prepared } = prepareFindings([securityCritical, secret, otherA, otherB], filesByPath);

      const { toStore, counts } = classifyFindings(prepared, options);

      expect(toStore).toHaveLength(4);
      expect(counts.merged).toBe(0);
    });

    it('treats unchecked input on the same lines as the injection it causes', () => {
      const restated = candidate({
        pass: 'maintainability',
        severity: 'major',
        category: 'unchecked-input',
        lineStart: 3,
        lineEnd: 3,
        title: 'SQL query built with unsanitized user input',
      });
      const elsewhere = candidate({
        pass: 'security',
        severity: 'major',
        category: 'unchecked-input',
        lineStart: 30,
        lineEnd: 30,
        title: 'Raw body inserted',
      });
      const { prepared } = prepareFindings([restated, securityCritical, elsewhere], filesByPath);

      const { toStore, counts } = classifyFindings(prepared, options);

      expect(toStore.map((f) => f.title)).toEqual([
        'SQL injection via concatenation',
        'Raw body inserted',
      ]);
      expect(counts.merged).toBe(1);
    });

    it('does not let a filtered low-confidence report swallow a confident one', () => {
      const unsure = candidate({ confidence: 0.3, title: 'Maybe injection' });
      const { prepared } = prepareFindings([unsure, correctnessMajor], filesByPath);

      const { toStore } = classifyFindings(prepared, options);

      // Sorted by severity first, so the filtered critical precedes the open major.
      expect(toStore.map((f) => [f.title, f.state])).toEqual([
        ['Maybe injection', 'filtered'],
        ['SQL injection risk in user query', 'open'],
      ]);
    });

    it('does not re-post another pass restating an issue already reported on the PR', () => {
      const { prepared } = prepareFindings([securityCritical, correctnessMajor], filesByPath);
      const reported = new Set([prepared[0]?.fingerprint ?? '']);

      const { toStore, counts } = classifyFindings(prepared, {
        ...options,
        alreadyReported: reported,
      });

      expect(toStore).toEqual([]);
      expect(counts).toMatchObject({ duplicate: 1, merged: 1, critical: 1 });
    });

    it('treats a restatement of a suppressed issue as suppressed too', () => {
      const { prepared } = prepareFindings([securityCritical, correctnessMajor], filesByPath);
      const suppressed = new Set([prepared[0]?.fingerprint ?? '']);

      const { toStore, counts } = classifyFindings(prepared, { ...options, suppressed });

      expect(toStore).toEqual([]);
      expect(counts).toMatchObject({ suppressed: 1, merged: 1, critical: 0 });
    });
  });

  it('moves inline findings beyond the cap to the body', () => {
    const { prepared } = prepareFindings(
      [candidate(), candidate({ title: 'Second', pass: 'correctness', category: 'other' })],
      filesByPath,
    );

    const { toStore } = classifyFindings(prepared, { ...options, maxInlineComments: 1 });

    expect(toStore.map((f) => f.placement)).toEqual(['inline', 'summary']);
  });
});
