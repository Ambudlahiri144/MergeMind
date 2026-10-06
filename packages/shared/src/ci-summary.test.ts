import { describe, expect, it } from 'vitest';

import { normalizeCiSummary } from './ci-summary.js';

const OUTPUT = {
  failingStep: '  Run npm test ',
  likelyCause: 'The refund test expects 9.99 but gets 10.',
  evidenceLines: [41, 999, 40, 41],
  suggestedFix: '   ',
  confidence: 1.7,
};

describe('normalizeCiSummary', () => {
  it('keeps only evidence lines that were shown, in order, and clamps the rest', () => {
    expect(normalizeCiSummary(OUTPUT, new Set([40, 41, 42]))).toEqual({
      failingStep: 'Run npm test',
      likelyCause: 'The refund test expects 9.99 but gets 10.',
      evidenceLines: [40, 41],
      suggestedFix: null,
      confidence: 1,
    });
  });

  it('returns null without a cause', () => {
    expect(normalizeCiSummary({ ...OUTPUT, likelyCause: ' ' }, new Set())).toBeNull();
  });
});
