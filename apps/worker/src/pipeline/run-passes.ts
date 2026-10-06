import {
  LlmUnavailableError,
  type ContextSnippet,
  type LlmCallRecord,
  type ReviewLlm,
} from '@mergemind/llm';
import type { CandidateFinding, LlmProviderName, ReviewPass } from '@mergemind/shared';
import pLimit from 'p-limit';

import type { ReviewChunk } from './chunk-hunks.js';

export type RunPassesInput = {
  runId: string;
  passes: readonly ReviewPass[];
  chunks: readonly ReviewChunk[];
  /** Retrieved context per chunk, same order as `chunks` (PRD F6). */
  contexts?: readonly (readonly ContextSnippet[])[];
  persona: string;
  isPrivateRepo: boolean;
  allowedProviders: readonly LlmProviderName[];
  concurrency: number;
};

export type RunPassesResult = {
  findings: CandidateFinding[];
  calls: LlmCallRecord[];
  /** Passes with at least one chunk that no provider could review. */
  failedPasses: ReviewPass[];
  /** No (pass, chunk) succeeded at all. */
  isAllFailed: boolean;
};

/**
 * Stage 9: every (pass, chunk) pair through the provider chain, bounded by p-limit. A pair whose
 * providers all fail is recorded; the run continues with the rest (rules.md §7).
 */
export async function runPasses(llm: ReviewLlm, input: RunPassesInput): Promise<RunPassesResult> {
  const limit = pLimit(input.concurrency);
  const tasks = input.passes.flatMap((pass) =>
    input.chunks.map((chunk, index) => ({ pass, chunk, context: input.contexts?.[index] ?? [] })),
  );

  const outcomes = await Promise.all(
    tasks.map(({ pass, chunk, context }) =>
      limit(async () => {
        try {
          const result = await llm.reviewPass({
            runId: input.runId,
            pass,
            persona: input.persona,
            files: chunk.files,
            ...(context.length > 0 ? { context } : {}),
            isPrivateRepo: input.isPrivateRepo,
            allowedProviders: input.allowedProviders,
          });
          // A model may cite a file from another chunk or invent one; keep only this chunk's.
          const paths = new Set(chunk.files.map((file) => file.path));
          return {
            pass,
            isOk: true,
            calls: result.calls,
            findings: result.findings.filter((finding) => paths.has(finding.path)),
          };
        } catch (error) {
          if (error instanceof LlmUnavailableError) {
            return { pass, isOk: false, calls: [...error.calls], findings: [] };
          }
          throw error;
        }
      }),
    ),
  );

  const failedPasses = [
    ...new Set(outcomes.filter((outcome) => !outcome.isOk).map((outcome) => outcome.pass)),
  ];
  return {
    findings: outcomes.flatMap((outcome) => outcome.findings),
    calls: outcomes.flatMap((outcome) => outcome.calls),
    failedPasses,
    isAllFailed: outcomes.length > 0 && outcomes.every((outcome) => !outcome.isOk),
  };
}
