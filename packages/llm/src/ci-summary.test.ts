import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { createCiSummaryLlm, type CiSummaryInput } from './ci-summary.js';
import { CI_SUMMARY_PROMPT_VERSION, buildCiSummaryUser } from './prompts/ci-summary.prompt.js';
import { LlmUnavailableError } from './structured-call.js';
import type { LlmTraceEvent } from './tracer.js';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

function textResult(text: string): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 300, noCache: 300, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 40, text: 40, reasoning: undefined },
    },
    warnings: [],
  };
}

const input: CiSummaryInput = {
  runId: 'ci-777-1',
  workflowName: 'CI',
  isPrivateRepo: true,
  allowedProviders: ['groq', 'ollama'],
  excerpts: [
    {
      jobName: 'test',
      stepName: 'Run npm test',
      lines: [
        { number: 40, text: 'FAIL src/refund.test.ts' },
        { number: 41, text: 'AssertionError: expected 10 to be 9.99' },
      ],
    },
  ],
};

describe('createCiSummaryLlm', () => {
  it('returns a normalised summary citing only lines it was shown, and traces ci-summary', async () => {
    const events: LlmTraceEvent[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: textResult(
        JSON.stringify({
          failingStep: 'test / Run npm test',
          likelyCause: 'Refund rounding changed: the test expects 9.99 but gets 10.',
          evidenceLines: [41, 7],
          suggestedFix: 'Round to two decimals before returning.',
          confidence: 0.8,
        }),
      ),
    });
    const llm = createCiSummaryLlm({
      providers: [{ name: 'groq', modelId: 'groq-model', model }],
      tracer: {
        record: (event) => events.push(event),
        flush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
    });

    const result = await llm.summarize(input);

    expect(result.summary).toMatchObject({ evidenceLines: [41], confidence: 0.8 });
    expect(result.promptVersion).toBe(CI_SUMMARY_PROMPT_VERSION);
    expect(result.calls).toEqual([expect.objectContaining({ provider: 'groq', inputTokens: 300 })]);
    expect(events.map((event) => [event.task, event.runId])).toEqual([['ci-summary', 'ci-777-1']]);
  });

  it('never sends a private repo log to a provider outside the allowlist', async () => {
    const gemini = new MockLanguageModelV4({ doGenerate: textResult('{}') });
    const llm = createCiSummaryLlm({
      providers: [{ name: 'gemini', modelId: 'gemini-model', model: gemini }],
    });

    await expect(llm.summarize(input)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(gemini.doGenerateCalls).toHaveLength(0);
  });

  it('fences the log as untrusted data with its line numbers', () => {
    const user = buildCiSummaryUser(input);

    expect(user).toContain('<log>\nJob: test / Run npm test\n40 | FAIL src/refund.test.ts');
    expect(user.trim().endsWith('</log>')).toBe(true);
  });
});
