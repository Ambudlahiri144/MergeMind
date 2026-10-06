import {
  CiSummaryOutputSchema,
  normalizeCiSummary,
  type CiSummary,
  type LlmProviderName,
} from '@mergemind/shared';

import {
  CI_SUMMARY_PROMPT_VERSION,
  CI_SUMMARY_SYSTEM,
  buildCiSummaryUser,
  type CiLogExcerptInput,
} from './prompts/ci-summary.prompt.js';
import {
  createStructuredCaller,
  type LlmCallRecord,
  type LlmChainConfig,
  type StructuredCaller,
} from './structured-call.js';

export type CiSummaryInput = {
  /** Groups the calls in tracing, like a review run id. */
  runId: string;
  workflowName: string;
  excerpts: readonly CiLogExcerptInput[];
  isPrivateRepo: boolean;
  allowedProviders: readonly LlmProviderName[];
};

export type CiSummaryResult = {
  /** Null when the model's answer had nothing usable (the comment then shows logs only). */
  summary: CiSummary | null;
  calls: LlmCallRecord[];
  promptVersion: string;
  provider: LlmProviderName;
};

export type CiSummaryLlm = {
  /** Throws `LlmUnavailableError` (with the calls made) when every allowed provider fails. */
  summarize(input: CiSummaryInput): Promise<CiSummaryResult>;
};

/** Explains a failed CI run from log excerpts (PRD F10), down the same provider chain. */
export function createCiSummaryLlm(
  config: LlmChainConfig | { caller: StructuredCaller },
): CiSummaryLlm {
  const call = 'caller' in config ? config.caller : createStructuredCaller(config);

  return {
    async summarize(input) {
      const result = await call({
        task: 'ci-summary',
        runId: input.runId,
        promptVersion: CI_SUMMARY_PROMPT_VERSION,
        system: CI_SUMMARY_SYSTEM,
        user: buildCiSummaryUser(input),
        schema: CiSummaryOutputSchema,
        isPrivateRepo: input.isPrivateRepo,
        allowedProviders: input.allowedProviders,
      });
      const shown = new Set(
        input.excerpts.flatMap((excerpt) => excerpt.lines.map((line) => line.number)),
      );
      return {
        summary: normalizeCiSummary(result.output, shown),
        calls: result.calls,
        promptVersion: CI_SUMMARY_PROMPT_VERSION,
        provider: result.provider,
      };
    },
  };
}
