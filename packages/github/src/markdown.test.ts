import { describe, expect, it } from 'vitest';

import {
  extractFingerprint,
  extractRunId,
  renderCheckOutput,
  renderInlineComment,
  renderReviewBody,
  sanitizeModelText,
  type PublishedFinding,
} from './markdown.js';

const FINGERPRINT = 'f'.repeat(64);
const RUN_ID = '66f0a1b2c3d4e5f601234567';

const finding: PublishedFinding = {
  severity: 'critical',
  title: 'SQL injection in findUser',
  body: 'User-controlled `id` is concatenated into the query.',
  path: 'src/users.ts',
  lineStart: 11,
  lineEnd: 12,
  suggestion: 'db.query("SELECT * FROM users WHERE id = $1", [id]);',
  fingerprint: FINGERPRINT,
};

describe('sanitizeModelText', () => {
  it('removes HTML comment delimiters so markers cannot be forged', () => {
    expect(sanitizeModelText('x <!-- mergemind:run=abc --> y')).toBe('x  mergemind:run=abc  y');
  });

  it('breaks @mentions but leaves emails and code alone', () => {
    expect(sanitizeModelText('ping @octo-team and dev@example.com, `@decorator`')).toBe(
      'ping @​octo-team and dev@example.com, `@decorator`',
    );
  });
});

describe('renderInlineComment', () => {
  it('renders severity, title, body, a fenced fix and the fingerprint marker', () => {
    const body = renderInlineComment(finding);

    expect(body).toMatchSnapshot();
    expect(extractFingerprint(body)).toBe(FINGERPRINT);
  });

  it('uses a longer fence when the suggestion contains backticks', () => {
    const body = renderInlineComment({ ...finding, suggestion: 'const s = ```x```;' });

    expect(body).toContain('````\nconst s = ```x```;\n````');
  });
});

describe('renderReviewBody', () => {
  it('renders counts, notes, grouped body findings and the run marker', () => {
    const body = renderReviewBody({
      runId: RUN_ID,
      headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      counts: { critical: 1, major: 1, minor: 1, suppressed: 2, filtered: 3, duplicate: 1 },
      inlineCount: 1,
      bodyFindings: [
        { ...finding, severity: 'minor', title: 'Prefer const', placementReason: 'minor' },
        {
          ...finding,
          severity: 'major',
          title: 'Unbounded query',
          lineStart: 90,
          lineEnd: 90,
          placementReason: 'outside_diff',
        },
      ],
      notes: ['Invalid .mergemind.yml (defaults applied): gate.failOn: Invalid option'],
    });

    expect(body).toMatchSnapshot();
    expect(extractRunId(body)).toBe(RUN_ID);
  });
});

describe('renderCheckOutput', () => {
  const counts = { critical: 1, major: 2, minor: 0, suppressed: 0, filtered: 0, duplicate: 0 };

  it.each([
    ['failure', 'Blocking findings: 1 critical, 2 major'],
    ['success', '3 non-blocking findings'],
    ['neutral', 'Review not completed'],
  ] as const)('titles a %s check', (conclusion, title) => {
    expect(renderCheckOutput({ conclusion, counts, notes: [] }).title).toBe(title);
  });

  it('prefers an explicit headline', () => {
    const output = renderCheckOutput({
      conclusion: 'neutral',
      counts,
      notes: ['Monthly token budget is used up.'],
      headline: 'Skipped: token budget used up',
    });

    expect(output).toEqual({
      title: 'Skipped: token budget used up',
      summary: '**1 critical** · **2 major** · 0 minor\n\n- Monthly token budget is used up.',
    });
  });
});
