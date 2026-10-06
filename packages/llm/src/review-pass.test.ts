import type { LlmProviderName } from '@mergemind/shared';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { CircuitBreaker, type Clock } from './circuit-breaker.js';
import { promptVersionFor } from './prompts/index.js';
import { renderFileDiff } from './prompts/render-diff.js';
import type { ProviderEntry } from './providers.js';
import { createReviewLlm, type ReviewPassInput } from './review-pass.js';
import { LlmUnavailableError } from './structured-call.js';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

function textResult(text: string, inputTokens = 100, outputTokens = 20): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: {
        total: inputTokens,
        noCache: inputTokens,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
    },
    warnings: [],
  };
}

const VALID_OUTPUT = JSON.stringify({
  findings: [
    {
      severity: 'critical',
      confidence: 0.92,
      category: 'injection',
      path: 'src/users.ts',
      lineStart: 11,
      lineEnd: 11,
      title: 'SQL injection',
      body: 'The id is interpolated into SQL.',
      suggestion: null,
    },
  ],
});

function rateLimited(): never {
  throw new APICallError({
    message: 'Rate limit reached',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  });
}

function provider(name: LlmProviderName, model: MockLanguageModelV4): ProviderEntry {
  return { name, modelId: `${name}-model`, model };
}

const input: ReviewPassInput = {
  runId: 'run-1',
  pass: 'security',
  persona: 'Strict reviewer.',
  isPrivateRepo: false,
  allowedProviders: ['groq', 'ollama'],
  files: [
    {
      path: 'src/users.ts',
      previousPath: null,
      hunks: [
        {
          header: '@@ -10,2 +10,2 @@',
          oldStart: 10,
          oldLines: 2,
          newStart: 10,
          newLines: 2,
          lines: [
            { kind: 'context', content: 'const db = getDb();', oldLine: 10, newLine: 10 },
            { kind: 'removed', content: 'const row = find(id);', oldLine: 11, newLine: null },
            {
              kind: 'added',
              content: 'const row = db.query(`... ${id}`);',
              oldLine: null,
              newLine: 11,
            },
          ],
        },
      ],
    },
  ],
};

describe('createReviewLlm.reviewPass', () => {
  it('returns normalized findings and one call record from the primary provider', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT, 1200, 80) });
    const llm = createReviewLlm({ providers: [provider('groq', groq)] });

    const result = await llm.reviewPass(input);

    expect(result.provider).toBe('groq');
    expect(result.promptVersion).toBe('security@2');
    expect(result.findings).toEqual([
      expect.objectContaining({
        pass: 'security',
        severity: 'critical',
        path: 'src/users.ts',
        suggestion: null,
      }),
    ]);
    expect(result.calls).toEqual([
      expect.objectContaining({
        provider: 'groq',
        inputTokens: 1200,
        outputTokens: 80,
        isFallback: false,
        outcome: 'ok',
      }),
    ]);
  });

  it('sends temperature 0 and the rendered diff', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });

    await createReviewLlm({ providers: [provider('groq', groq)] }).reviewPass(input);

    const [call] = groq.doGenerateCalls;
    expect(call?.temperature).toBe(0);
    expect(JSON.stringify(call?.prompt)).toContain('11 + const row = db.query');
  });

  it('falls back to the next provider on a 429', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: rateLimited });
    const ollama = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const llm = createReviewLlm({
      providers: [provider('groq', groq), provider('ollama', ollama)],
    });

    const result = await llm.reviewPass(input);

    expect(result.provider).toBe('ollama');
    expect(result.calls.map((call) => [call.provider, call.outcome, call.isFallback])).toEqual([
      ['groq', 'error', false],
      ['ollama', 'ok', true],
    ]);
  });

  it('repairs invalid output once on the same provider', async () => {
    const groq = new MockLanguageModelV4({
      doGenerate: [textResult('not json at all'), textResult(VALID_OUTPUT)],
    });
    const llm = createReviewLlm({ providers: [provider('groq', groq)] });

    const result = await llm.reviewPass(input);

    expect(result.findings).toHaveLength(1);
    expect(result.calls.map((call) => call.outcome)).toEqual(['invalid_output', 'ok']);
    expect(JSON.stringify(groq.doGenerateCalls[1]?.prompt)).toContain(
      'did not match the required JSON schema',
    );
  });

  it('repairs once when a strict provider rejects its own output server-side (Groq 400)', async () => {
    let call = 0;
    const groq = new MockLanguageModelV4({
      doGenerate: () => {
        call += 1;
        if (call === 1) {
          // Shape observed live from Groq on 2026-10-06.
          throw new APICallError({
            message:
              "Generated JSON does not match the expected schema. Error: jsonschema: '/findings/1' does not validate with /properties/findings/items/type: expected object, but got string",
            url: 'https://api.groq.com/openai/v1/chat/completions',
            requestBodyValues: {},
            statusCode: 400,
            responseBody: '{"error":{"code":"json_validate_failed"}}',
            isRetryable: false,
          });
        }
        return Promise.resolve(textResult(VALID_OUTPUT));
      },
    });
    const ollama = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const llm = createReviewLlm({
      providers: [provider('groq', groq), provider('ollama', ollama)],
    });

    const result = await llm.reviewPass(input);

    expect(result.provider).toBe('groq');
    expect(result.calls.map((c) => c.outcome)).toEqual(['invalid_output', 'ok']);
    expect(JSON.stringify(groq.doGenerateCalls[1]?.prompt)).toContain('Validator error:');
    expect(ollama.doGenerateCalls).toHaveLength(0);
  });

  it('does not treat an unrelated 400 as a schema problem', async () => {
    const groq = new MockLanguageModelV4({
      doGenerate: () => {
        throw new APICallError({
          message: 'model_decommissioned',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 400,
          isRetryable: false,
        });
      },
    });
    const ollama = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const llm = createReviewLlm({
      providers: [provider('groq', groq), provider('ollama', ollama)],
    });

    const result = await llm.reviewPass(input);

    expect(groq.doGenerateCalls).toHaveLength(1);
    expect(result.provider).toBe('ollama');
  });

  it('moves on after a second invalid output', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: textResult('{"findings": "nope"}') });
    const ollama = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const llm = createReviewLlm({
      providers: [provider('groq', groq), provider('ollama', ollama)],
    });

    const result = await llm.reviewPass(input);

    expect(groq.doGenerateCalls).toHaveLength(2);
    expect(result.provider).toBe('ollama');
  });

  it('throws LlmUnavailableError carrying every call when all providers fail', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: rateLimited });
    const ollama = new MockLanguageModelV4({
      doGenerate: () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      },
    });
    const llm = createReviewLlm({
      providers: [provider('groq', groq), provider('ollama', ollama)],
    });

    const error: unknown = await llm.reviewPass(input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as LlmUnavailableError).calls).toHaveLength(2);
  });

  it('never calls a provider outside the private-repo allowlist', async () => {
    const gemini = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const ollama = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const llm = createReviewLlm({
      providers: [provider('gemini', gemini), provider('ollama', ollama)],
    });

    const result = await llm.reviewPass({
      ...input,
      isPrivateRepo: true,
      allowedProviders: ['ollama'],
    });

    expect(gemini.doGenerateCalls).toHaveLength(0);
    expect(result.provider).toBe('ollama');
  });

  it('skips a provider whose circuit is open', async () => {
    let now = 0;
    const clock: Clock = { now: () => now };
    const groq = new MockLanguageModelV4({ doGenerate: rateLimited });
    const ollama = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });
    const llm = createReviewLlm({
      providers: [provider('groq', groq), provider('ollama', ollama)],
      breaker: new CircuitBreaker(clock),
      clock,
    });

    for (let call = 0; call < 4; call += 1) {
      await llm.reviewPass(input);
    }
    now = 60_000;
    await llm.reviewPass(input);

    expect(groq.doGenerateCalls).toHaveLength(4);
  });
});

describe('CircuitBreaker', () => {
  it('opens after 3 failures, half-opens after the cooldown, closes on success', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ now: () => now });

    breaker.recordFailure('groq');
    breaker.recordFailure('groq');
    const isOpenAfterTwo = !breaker.canCall('groq');
    breaker.recordFailure('groq');
    const isOpenAfterThree = !breaker.canCall('groq');
    now = 59_999;
    const isStillOpen = !breaker.canCall('groq');
    now = 60_000;
    const isHalfOpen = breaker.canCall('groq');
    breaker.recordSuccess('groq');

    expect([isOpenAfterTwo, isOpenAfterThree, isStillOpen, isHalfOpen]).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(breaker.canCall('groq')).toBe(true);
  });

  it('re-opens on a failed half-open call', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ now: () => now });
    [1, 2, 3].forEach(() => {
      breaker.recordFailure('ollama');
    });
    now = 60_000;

    breaker.recordFailure('ollama');

    expect(breaker.canCall('ollama')).toBe(false);
  });
});

describe('prompts', () => {
  it('joins pass versions for reviewRuns.promptVersion', () => {
    expect(promptVersionFor(['security', 'correctness', 'maintainability'])).toBe(
      'security@2+correctness@2+maintainability@2',
    );
  });

  it('renders head-side numbers and leaves removed lines unnumbered', () => {
    expect(renderFileDiff(input.files[0]!)).toBe(
      [
        'File: src/users.ts',
        '@@ -10,2 +10,2 @@',
        '   10   const db = getDb();',
        '      - const row = find(id);',
        '   11 + const row = db.query(`... ${id}`);',
      ].join('\n'),
    );
  });
});

describe('prompt context (PRD F6)', () => {
  it('adds retrieved code as a read-only context block before the diff', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });

    await createReviewLlm({ providers: [provider('groq', groq)] }).reviewPass({
      ...input,
      context: [
        {
          path: 'src/db.ts',
          symbol: 'query',
          startLine: 3,
          endLine: 5,
          content: 'export function query(sql: string) {}',
        },
      ],
    });

    const prompt = JSON.stringify(groq.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('File: src/db.ts (query, lines 3-5)');
    expect(prompt).toContain('do not report issues in it');
    expect(prompt.indexOf('<context>')).toBeLessThan(prompt.indexOf('<diff>'));
  });

  it('omits the block when there is no context', async () => {
    const groq = new MockLanguageModelV4({ doGenerate: textResult(VALID_OUTPUT) });

    await createReviewLlm({ providers: [provider('groq', groq)] }).reviewPass(input);

    expect(JSON.stringify(groq.doGenerateCalls[0]?.prompt)).not.toContain('<context>');
  });
});
