import { z } from 'zod';

import { SEVERITIES, type ReviewPass, type Severity } from '../domain.js';

/** Bug categories. The eval benchmark matches on these (Testing.md §4). */
export const FINDING_CATEGORIES = [
  'injection',
  'hardcoded-secret',
  'missing-await',
  'null-deref',
  'unbounded-query',
  'unchecked-input',
  'race-condition',
  'resource-leak',
  'off-by-one',
  'swallowed-error',
  'other',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const MAX_FINDINGS_PER_PASS = 20;
export const MAX_FINDING_TITLE_LENGTH = 120;
export const MAX_FINDING_BODY_LENGTH = 2000;

/**
 * What a model must return for one finding. Kept structurally simple on purpose: Groq strict
 * JSON-schema mode requires every key and rejects optional ones, so `suggestion` is nullable and
 * range limits (confidence, lengths) are enforced by `normalizeFinding`, not by the schema (ADR-019).
 */
export const ReviewFindingOutputSchema = z.object({
  severity: z.enum(SEVERITIES),
  confidence: z.number(),
  category: z.enum(FINDING_CATEGORIES),
  path: z.string(),
  lineStart: z.int(),
  lineEnd: z.int(),
  title: z.string(),
  body: z.string(),
  suggestion: z.string().nullable(),
});
export type ReviewFindingOutput = z.infer<typeof ReviewFindingOutputSchema>;

export const ReviewPassOutputSchema = z.object({
  findings: z.array(ReviewFindingOutputSchema),
});
export type ReviewPassOutput = z.infer<typeof ReviewPassOutputSchema>;

/** A model finding after normalization, tagged with the pass that produced it. */
export type CandidateFinding = Omit<ReviewFindingOutput, 'suggestion'> & {
  pass: ReviewPass;
  suggestion: string | null;
};

export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Brings a model finding into range: confidence in [0, 1], ordered positive line numbers,
 * trimmed and length-capped text. Returns null if nothing usable is left.
 */
export function normalizeFinding(
  finding: ReviewFindingOutput,
  pass: ReviewPass,
): CandidateFinding | null {
  const title = finding.title.trim().slice(0, MAX_FINDING_TITLE_LENGTH);
  const body = finding.body.trim().slice(0, MAX_FINDING_BODY_LENGTH);
  const path = finding.path.trim().replace(/^\/+/, '');
  if (title === '' || body === '' || path === '' || !Number.isFinite(finding.confidence)) {
    return null;
  }
  const lineStart = Math.max(1, Math.min(finding.lineStart, finding.lineEnd));
  const lineEnd = Math.max(1, Math.max(finding.lineStart, finding.lineEnd));
  const suggestion = finding.suggestion?.trim() ?? '';
  return {
    pass,
    severity: finding.severity,
    confidence: clamp(finding.confidence, 0, 1),
    category: finding.category,
    path,
    lineStart,
    lineEnd,
    title,
    body,
    suggestion: suggestion === '' ? null : suggestion.slice(0, MAX_FINDING_BODY_LENGTH),
  };
}

/** Most severe first, then most confident, then by location for a stable order. */
export function compareFindings(
  a: Pick<CandidateFinding, 'severity' | 'confidence' | 'path' | 'lineStart'>,
  b: Pick<CandidateFinding, 'severity' | 'confidence' | 'path' | 'lineStart'>,
): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.confidence - a.confidence ||
    a.path.localeCompare(b.path) ||
    a.lineStart - b.lineStart
  );
}
