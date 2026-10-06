import {
  MAX_FINDINGS_PER_PASS,
  ReviewPassOutputSchema,
  normalizeFinding,
  type CandidateFinding,
  type FileDiff,
  type LlmProviderName,
  type ReviewPass,
} from '@mergemind/shared';

import { REVIEW_PROMPTS, type ContextSnippet } from './prompts/index.js';
import {
  createStructuredCaller,
  type LlmCallRecord,
  type LlmChainConfig,
  type StructuredCaller,
} from './structured-call.js';

export type ReviewPassInput = {
  runId: string;
  pass: ReviewPass;
  persona: string;
  files: readonly Pick<FileDiff, 'path' | 'previousPath' | 'hunks'>[];
  /** Retrieved repository code for this chunk (PRD F6); omitted when the index is not ready. */
  context?: readonly ContextSnippet[];
  isPrivateRepo: boolean;
  allowedProviders: readonly LlmProviderName[];
};

export type ReviewPassResult = {
  pass: ReviewPass;
  findings: CandidateFinding[];
  calls: LlmCallRecord[];
  promptVersion: string;
  provider: LlmProviderName;
};

export type ReviewLlm = {
  reviewPass(input: ReviewPassInput): Promise<ReviewPassResult>;
};

/** A chain of its own, or a caller shared with other LLM uses (one circuit breaker). */
export type ReviewLlmConfig = LlmChainConfig | { caller: StructuredCaller };

/** One review pass down the provider chain (ADR-007, ADR-019); see `createStructuredCaller`. */
export function createReviewLlm(config: ReviewLlmConfig): ReviewLlm {
  const call = 'caller' in config ? config.caller : createStructuredCaller(config);

  return {
    async reviewPass(input) {
      const prompt = REVIEW_PROMPTS[input.pass];
      const user = prompt.buildUser({
        persona: input.persona,
        files: input.files,
        ...(input.context === undefined ? {} : { context: input.context }),
      });
      const result = await call({
        task: `review.${input.pass}`,
        runId: input.runId,
        promptVersion: prompt.version,
        system: prompt.system,
        user,
        schema: ReviewPassOutputSchema,
        isPrivateRepo: input.isPrivateRepo,
        allowedProviders: input.allowedProviders,
      });
      const findings = result.output.findings
        .slice(0, MAX_FINDINGS_PER_PASS)
        .map((finding) => normalizeFinding(finding, input.pass))
        .filter((finding): finding is CandidateFinding => finding !== null);
      return {
        pass: input.pass,
        findings,
        calls: result.calls,
        promptVersion: prompt.version,
        provider: result.provider,
      };
    },
  };
}
