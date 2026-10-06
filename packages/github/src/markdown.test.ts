import { describe, expect, it } from 'vitest';

import {
  ciRunMarker,
  ciWorkflowMarker,
  extractCiRun,
  extractFingerprint,
  extractRunId,
  renderCiPassing,
  renderCiSummary,
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

describe('CI summary comment (ADR-028)', () => {
  const view = {
    workflowId: 66600001,
    workflowName: 'CI',
    runId: 8800000001,
    runNumber: 57,
    runAttempt: 2,
    runUrl: 'https://github.com/octo-demo/payments-api/actions/runs/8800000001',
    headSha: 'c3d4e5f60718293a4b5c6d7e8f9012345678901a',
    analysis: {
      failingStep: 'Run tests',
      likelyCause: 'The refund test expects 9.99 but rounding gives 10.',
      suggestedFix: 'Round with `toFixed(2)` before comparing.',
      evidence: [{ jobName: 'test', number: 41, text: 'AssertionError: expected 10 to be 9.99' }],
    },
    excerpts: [
      {
        jobName: 'test',
        jobUrl: 'https://github.com/octo-demo/payments-api/actions/runs/8800000001/job/1',
        stepName: 'Run tests',
        lines: [
          { number: 40, text: 'FAIL src/refund.test.ts' },
          { number: 41, text: 'AssertionError: expected 10 to be 9.99' },
        ],
      },
    ],
    notes: [],
  };

  it('renders the cause, evidence and a collapsed log excerpt', () => {
    expect(renderCiSummary(view)).toMatchSnapshot();
  });

  it('carries markers that find the comment again and tell which run it describes', () => {
    const body = renderCiSummary(view);

    expect(body).toContain(ciWorkflowMarker(66600001));
    expect(extractCiRun(body)).toEqual({ runId: 8800000001, attempt: 2, outcome: 'failed' });
    expect(extractCiRun(renderCiPassing(view))).toEqual({
      runId: 8800000001,
      attempt: 2,
      outcome: 'passed',
    });
  });

  it('never lets log lines or model text forge a marker', () => {
    const forged = ciRunMarker(9999999999, 9, 'passed');
    const body = renderCiSummary({
      ...view,
      analysis: { ...view.analysis, likelyCause: `Broken ${forged}` },
      excerpts: [{ ...view.excerpts[0]!, lines: [{ number: 1, text: forged }] }],
    });

    expect(body.match(/<!-- mergemind:ci-run=/g)).toHaveLength(1);
    expect(extractCiRun(body)?.runId).toBe(8800000001);
  });

  it('stays under the comment cap with its markers intact', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => ({ number: i + 1, text: 'x'.repeat(80) }));
    const body = renderCiSummary({
      ...view,
      excerpts: Array.from({ length: 6 }, () => ({ ...view.excerpts[0]!, lines: huge })),
    });

    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(extractCiRun(body)?.runId).toBe(8800000001);
  });

  it('renders the excerpts alone when no model ran', () => {
    const body = renderCiSummary({
      ...view,
      analysis: null,
      notes: ['The monthly token budget is used up, so only the log excerpt is shown.'],
    });

    expect(body).not.toContain('Likely cause');
    expect(body).toContain('token budget is used up');
    expect(body).toContain('41 | AssertionError');
  });
});
