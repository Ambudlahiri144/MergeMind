import { describe, expect, it } from 'vitest';

import { BUDGET_WARN_RATIO, evaluateBudget, usagePeriod } from './budget.js';
import {
  MAX_FINDING_TITLE_LENGTH,
  compareFindings,
  normalizeFinding,
  type ReviewFindingOutput,
} from './findings.js';
import { computeFingerprint, normalizeCode, slugifyTitle } from './fingerprint.js';
import { evaluateGate } from './gate.js';

describe('evaluateGate', () => {
  const critical = { severity: 'critical' as const };
  const major = { severity: 'major' as const };
  const minor = { severity: 'minor' as const };

  it.each([
    ['critical', [critical], 'failure'],
    ['critical', [major, minor], 'success'],
    ['major', [major], 'failure'],
    ['major', [critical], 'failure'],
    ['major', [minor], 'success'],
    ['never', [critical, major], 'success'],
    ['critical', [], 'success'],
  ] as const)('failOn=%s with %o is %s', (failOn, findings, expected) => {
    expect(evaluateGate(failOn, findings)).toBe(expected);
  });
});

describe('computeFingerprint', () => {
  const base = {
    pass: 'security' as const,
    path: 'src/users.ts',
    code: 'const q = `SELECT * FROM users WHERE id = ${id}`;',
    title: 'SQL injection in user lookup',
  };

  it('is stable under re-indentation and blank lines', () => {
    const shifted = { ...base, code: `\n    ${base.code.replace(' = ', '   =   ')}\n\n` };

    expect(computeFingerprint(shifted)).toBe(computeFingerprint(base));
  });

  it('is stable under title punctuation and case', () => {
    expect(computeFingerprint({ ...base, title: 'SQL Injection in user-lookup!' })).toBe(
      computeFingerprint(base),
    );
  });

  it.each([
    ['path', { path: 'src/orders.ts' }],
    ['pass', { pass: 'correctness' as const }],
    ['code', { code: 'const q = db.users.find(id);' }],
  ])('differs when the %s differs', (_label, change) => {
    expect(computeFingerprint({ ...base, ...change })).not.toBe(computeFingerprint(base));
  });

  it('normalizes code and slugs titles', () => {
    expect(normalizeCode('  a  =  1\n\n\tb\n')).toBe('a = 1\nb');
    expect(slugifyTitle('  Missing `await` on save() ')).toBe('missing-await-on-save');
  });
});

describe('normalizeFinding', () => {
  const output: ReviewFindingOutput = {
    severity: 'major',
    confidence: 1.4,
    category: 'missing-await',
    path: '/src/orders.ts',
    lineStart: 30,
    lineEnd: 12,
    title: `  ${'t'.repeat(200)} `,
    body: ' Body text. ',
    suggestion: '   ',
  };

  it('clamps confidence, orders lines, trims and caps text', () => {
    expect(normalizeFinding(output, 'correctness')).toEqual({
      pass: 'correctness',
      severity: 'major',
      confidence: 1,
      category: 'missing-await',
      path: 'src/orders.ts',
      lineStart: 12,
      lineEnd: 30,
      title: 't'.repeat(MAX_FINDING_TITLE_LENGTH),
      body: 'Body text.',
      suggestion: null,
    });
  });

  it('drops a finding with an empty body', () => {
    expect(normalizeFinding({ ...output, body: '  ' }, 'security')).toBeNull();
  });

  it('drops a finding with a non-finite confidence', () => {
    expect(normalizeFinding({ ...output, confidence: Number.NaN }, 'security')).toBeNull();
  });
});

describe('compareFindings', () => {
  it('sorts by severity, then confidence, then location', () => {
    const findings = [
      { severity: 'minor' as const, confidence: 0.99, path: 'a.ts', lineStart: 1 },
      { severity: 'critical' as const, confidence: 0.75, path: 'b.ts', lineStart: 9 },
      { severity: 'critical' as const, confidence: 0.95, path: 'c.ts', lineStart: 1 },
      { severity: 'critical' as const, confidence: 0.75, path: 'b.ts', lineStart: 2 },
    ];

    const sorted = findings.toSorted(compareFindings).map((f) => `${f.path}:${f.lineStart}`);

    expect(sorted).toEqual(['c.ts:1', 'b.ts:2', 'b.ts:9', 'a.ts:1']);
  });
});

describe('evaluateBudget', () => {
  const budget = 1_000;

  it.each([
    [0, 'ok'],
    [budget * BUDGET_WARN_RATIO - 1, 'ok'],
    [budget * BUDGET_WARN_RATIO, 'warn'],
    [budget - 1, 'warn'],
    [budget, 'exhausted'],
    [budget * 2, 'exhausted'],
  ])('%i of 1000 tokens is %s', (used, expected) => {
    expect(evaluateBudget(used, budget)).toBe(expected);
  });

  it('treats a zero budget as exhausted', () => {
    expect(evaluateBudget(0, 0)).toBe('exhausted');
  });
});

describe('usagePeriod', () => {
  it('uses the UTC month, so 23:30 on the last day in UTC-5 is still that month in UTC', () => {
    expect(usagePeriod(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(usagePeriod(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
    expect(usagePeriod(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01');
  });
});
