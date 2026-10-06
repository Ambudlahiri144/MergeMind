import { z } from 'zod';

export const MAX_CI_EVIDENCE_LINES = 8;
const MAX_CI_STEP_LENGTH = 200;
const MAX_CI_TEXT_LENGTH = 1_200;

/**
 * What a model returns for a failed CI run (PRD F10). Like the review schema (ADR-019) it has
 * no optional keys and no range limits, for Groq strict mode; `normalizeCiSummary` enforces them.
 */
export const CiSummaryOutputSchema = z.object({
  failingStep: z.string(),
  likelyCause: z.string(),
  /** Log line numbers, as printed on the left of the excerpt, that show the failure. */
  evidenceLines: z.array(z.int()),
  suggestedFix: z.string().nullable(),
  confidence: z.number(),
});
export type CiSummaryOutput = z.infer<typeof CiSummaryOutputSchema>;

export type CiSummary = CiSummaryOutput;

/**
 * Trims and caps the text, clamps confidence to [0, 1], and keeps only evidence lines that are
 * really in the excerpt shown to the model (unique, in log order). Null if nothing is usable.
 */
export function normalizeCiSummary(
  output: CiSummaryOutput,
  shownLines: ReadonlySet<number>,
): CiSummary | null {
  const failingStep = output.failingStep.trim().slice(0, MAX_CI_STEP_LENGTH);
  const likelyCause = output.likelyCause.trim().slice(0, MAX_CI_TEXT_LENGTH);
  if (likelyCause === '' || !Number.isFinite(output.confidence)) {
    return null;
  }
  const suggestedFix = output.suggestedFix?.trim().slice(0, MAX_CI_TEXT_LENGTH) ?? '';
  const evidenceLines = [...new Set(output.evidenceLines)]
    .filter((line) => shownLines.has(line))
    .sort((a, b) => a - b)
    .slice(0, MAX_CI_EVIDENCE_LINES);
  return {
    failingStep: failingStep === '' ? 'unknown step' : failingStep,
    likelyCause,
    evidenceLines,
    suggestedFix: suggestedFix === '' ? null : suggestedFix,
    confidence: Math.min(1, Math.max(0, output.confidence)),
  };
}
