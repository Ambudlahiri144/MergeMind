import { describe, expect, it } from 'vitest';

import { EXCERPT_LIMITS, extractFailureWindow, normalizeLog } from './extract-log.js';
import { redactLogLine } from './redact.js';

const TS = '2026-10-06T10:00:00.1234567Z ';

/** A GitHub-style job log: checkout, a failing test step, then post-job cleanup. */
function jobLog(testLines: readonly string[]): string {
  return [
    `${TS}##[group]Run actions/checkout@v4`,
    `${TS}Syncing repository: octo-demo/payments-api`,
    `${TS}##[endgroup]`,
    `${TS}##[group]Run npm test`,
    `${TS}npm test`,
    `${TS}##[endgroup]`,
    ...testLines.map((line) => `${TS}${line}`),
    `${TS}##[error]Process completed with exit code 1.`,
    `${TS}##[group]Run actions/checkout@v4`,
    `${TS}Post job cleanup. An error here is not the failure.`,
    `${TS}##[endgroup]`,
  ].join('\n');
}

function extract(log: string) {
  return extractFailureWindow({ jobName: 'test', jobUrl: null, failedStep: 'Run npm test', log });
}

describe('normalizeLog', () => {
  it('strips timestamps and ANSI colours and keeps 1-based line numbers', () => {
    const lines = normalizeLog(`${TS}\u001b[31mFAIL\u001b[0m src/a.test.ts\n${TS}done\n`);

    expect(lines).toEqual([
      { number: 1, text: 'FAIL src/a.test.ts' },
      { number: 2, text: 'done' },
    ]);
  });

  it('accepts a log without timestamps', () => {
    expect(normalizeLog('plain\r\nlines')).toEqual([
      { number: 1, text: 'plain' },
      { number: 2, text: 'lines' },
    ]);
  });
});

describe('extractFailureWindow', () => {
  it('cites the failing step only, with the original line numbers', () => {
    const { excerpt, anchorCount } = extract(
      jobLog(['> vitest run', 'FAIL src/refund.test.ts', 'AssertionError: expected 10 to be 9.99']),
    );

    expect(excerpt.lines.map((line) => line.text)).toEqual([
      'Run npm test',
      'npm test',
      '> vitest run',
      'FAIL src/refund.test.ts',
      'AssertionError: expected 10 to be 9.99',
      'Error: Process completed with exit code 1.',
    ]);
    // Line 4 of the raw log is "##[group]Run npm test"; the endgroup lines are dropped.
    expect(excerpt.lines[0]?.number).toBe(4);
    expect(excerpt.lines.at(-1)?.number).toBe(10);
    expect(excerpt.lines.some((line) => line.text.includes('Post job cleanup'))).toBe(false);
    expect(anchorCount).toBe(3);
  });

  it('ends at the exit-code error, before post-job cleanup that has no group marker', () => {
    // Live PR #3 (2026-10-06): "Post job cleanup." follows the failed step without a
    // ##[group]Run line, and the 10-lines-after window pulled git cleanup into the excerpt.
    const log = [
      `${TS}##[group]Run node --test tests/`,
      `${TS}node --test tests/`,
      `${TS}##[endgroup]`,
      `${TS}# Error: Cannot find module 'tests'`,
      `${TS}# fail 1`,
      `${TS}##[error]Process completed with exit code 1.`,
      `${TS}Post job cleanup.`,
      `${TS}[command]/usr/bin/git version`,
      `${TS}git version 2.55.0`,
      `${TS}Cleaning up orphan processes`,
    ].join('\n');

    const { excerpt } = extract(log);

    expect(excerpt.lines.at(-1)?.text).toBe('Error: Process completed with exit code 1.');
    expect(excerpt.lines.some((line) => line.text.includes('git version'))).toBe(false);
  });

  it('keeps windows around the first and last errors of a long step within the cap', () => {
    const noise = (count: number) => Array.from({ length: count }, (_, i) => `ok test ${i}`);
    const { excerpt } = extract(
      jobLog([
        ...noise(100),
        'TypeError: cannot read properties of undefined',
        ...noise(300),
        'Tests: 1 failed, 400 passed',
      ]),
    );
    const texts = excerpt.lines.map((line) => line.text);

    expect(excerpt.lines.length).toBeLessThanOrEqual(EXCERPT_LIMITS.maxLines);
    expect(texts).toContain('TypeError: cannot read properties of undefined');
    expect(texts).toContain('Tests: 1 failed, 400 passed');
    expect(texts.at(-1)).toBe('Error: Process completed with exit code 1.');
  });

  it('shows the tail of a log with no error markers at all', () => {
    const log = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');

    const { excerpt, anchorCount } = extract(log);

    expect(anchorCount).toBe(0);
    expect(excerpt.lines).toHaveLength(EXCERPT_LIMITS.tailWhenNoAnchor);
    expect(excerpt.lines.at(-1)).toEqual({ number: 200, text: 'line 200' });
  });

  it('caps characters, keeping the error lines at the end', () => {
    const long = Array.from({ length: 60 }, (_, i) => `error ${i} ${'x'.repeat(250)}`);

    const { excerpt } = extract(jobLog(long));
    const chars = excerpt.lines.reduce((total, line) => total + line.text.length + 1, 0);

    expect(chars).toBeLessThanOrEqual(EXCERPT_LIMITS.maxChars);
    expect(excerpt.lines.at(-1)?.text).toBe('Error: Process completed with exit code 1.');
  });

  it('redacts credentials before anything leaves the machine', () => {
    const { excerpt } = extract(
      jobLog(['Error: auth failed with ghp_abcdefghijklmnopqrstuvwxyz123456']),
    );

    expect(excerpt.lines.map((line) => line.text).join('\n')).not.toContain('ghp_');
  });
});

describe('redactLogLine', () => {
  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz123456', 'token [redacted]'],
    ['key sk_live_51HxYzTEST1234567890', 'key [redacted]'],
    ['AWS AKIAABCDEFGHIJKLMNOP used', 'AWS [redacted] used'],
    ['password=hunter2hunter', 'password=[redacted]'],
    ['Authorization: Bearer abcdefghijklmnop.qrstuv', 'Authorization: Bearer [redacted]'],
    ['-----BEGIN RSA PRIVATE KEY-----', '[redacted]'],
  ])('masks %s', (line, expected) => {
    expect(redactLogLine(line)).toBe(expected);
  });

  it('leaves ordinary log lines and GitHub-masked secrets alone', () => {
    expect(redactLogLine('Tests: 3 failed, token=***')).toBe('Tests: 3 failed, token=***');
  });
});
