import type { LlmProviderName } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';
import { APICallError, NoObjectGeneratedError, Output, generateText, type ModelMessage } from 'ai';
import type { z } from 'zod';

import { CircuitBreaker, systemClock, type Clock } from './circuit-breaker.js';
import { isProviderAllowed } from './provider-policy.js';
import type { ProviderEntry } from './providers.js';
import { noopTracer, type LlmCallOutcome, type LlmTracer } from './tracer.js';

/** Default per-call timeout (Architecture.md §6, `LLM_TIMEOUT_MS`). */
export const DEFAULT_LLM_TIMEOUT_MS = 45_000;

/** One provider call, successful or not; each becomes a `usageLedger` row. */
export type LlmCallRecord = {
  provider: LlmProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  isFallback: boolean;
  outcome: LlmCallOutcome;
};

/** Every allowed provider failed (or none is allowed). Carries the calls made, for the ledger. */
export class LlmUnavailableError extends Error {
  constructor(
    /** What was asked: a review pass (`security`) or a task label (`ci-summary`). */
    readonly task: string,
    readonly calls: readonly LlmCallRecord[],
    options: { cause?: unknown } = {},
  ) {
    super(`No LLM provider completed the ${task} call`, options);
    this.name = 'LlmUnavailableError';
  }
}

/** The provider chain shared by every LLM use (one circuit breaker for all of them). */
export type LlmChainConfig = {
  providers: readonly ProviderEntry[];
  timeoutMs?: number;
  breaker?: CircuitBreaker;
  clock?: Clock;
  tracer?: LlmTracer;
  logger?: Logger;
};

export type StructuredCallInput<Schema extends z.ZodType> = {
  /** Trace name, e.g. `review.security` or `ci-summary`. */
  task: string;
  runId: string;
  promptVersion: string;
  system: string;
  user: string;
  schema: Schema;
  isPrivateRepo: boolean;
  allowedProviders: readonly LlmProviderName[];
};

export type StructuredCallResult<T> = {
  output: T;
  calls: LlmCallRecord[];
  provider: LlmProviderName;
};

export type StructuredCaller = <Schema extends z.ZodType>(
  input: StructuredCallInput<Schema>,
) => Promise<StructuredCallResult<z.infer<Schema>>>;

const REPAIR_INSTRUCTION =
  'Your previous reply did not match the required JSON schema. Reply again with only the JSON object, following every output rule.';

const HTTP_BAD_REQUEST = 400;
const MAX_REPAIR_ERROR_LENGTH = 300;
const SCHEMA_REJECTION_PATTERN = /json_validate_failed|does not match the expected schema/i;

/** Groq returns `400 json_validate_failed` when constrained output still breaks the schema. */
function isServerSchemaRejection(error: unknown): error is APICallError {
  return (
    APICallError.isInstance(error) &&
    error.statusCode === HTTP_BAD_REQUEST &&
    SCHEMA_REJECTION_PATTERN.test(`${error.message} ${error.responseBody ?? ''}`)
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * One structured-output call down the provider chain (ADR-007, ADR-019, ADR-028):
 * - any provider error (429, 5xx, timeout, bad request) → next provider;
 * - output that fails the schema → one repair re-ask on the same provider, then next provider;
 * - open circuit or not on the private-repo allowlist → provider skipped.
 * `temperature: 0` and `maxRetries: 0`: determinism, and our chain owns retries.
 */
export function createStructuredCaller(config: LlmChainConfig): StructuredCaller {
  const clock = config.clock ?? systemClock;
  const breaker = config.breaker ?? new CircuitBreaker(clock);
  const tracer = config.tracer ?? noopTracer;
  const timeoutMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

  return async function callStructured<Schema extends z.ZodType>(
    input: StructuredCallInput<Schema>,
  ): Promise<StructuredCallResult<z.infer<Schema>>> {
    const chain = config.providers.filter((provider) => isProviderAllowed(provider.name, input));
    const calls: LlmCallRecord[] = [];
    let lastError: unknown = new Error('No provider is allowed for this repository');

    for (const provider of chain) {
      if (!breaker.canCall(provider.name)) {
        config.logger?.warn({ provider: provider.name, task: input.task }, 'provider.skipped');
        continue;
      }
      const isFallback = provider !== chain[0];
      let messages: ModelMessage[] = [{ role: 'user', content: input.user }];

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const startedAt = clock.now();
        const record = (
          outcome: LlmCallOutcome,
          usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined },
          output?: unknown,
        ) => {
          const call: LlmCallRecord = {
            provider: provider.name,
            model: provider.modelId,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            latencyMs: Math.max(0, clock.now() - startedAt),
            isFallback,
            outcome,
          };
          calls.push(call);
          tracer.record({
            ...call,
            runId: input.runId,
            task: input.task,
            promptVersion: input.promptVersion,
            system: input.system,
            user: input.user,
            output,
            isPrivateRepo: input.isPrivateRepo,
          });
        };

        try {
          const result = await generateText({
            model: provider.model,
            system: input.system,
            messages,
            output: Output.object({ schema: input.schema }),
            temperature: 0,
            maxRetries: 0,
            timeout: timeoutMs,
          });
          const output = result.output as z.infer<Schema>;
          record('ok', result.usage, output);
          breaker.recordSuccess(provider.name);
          return { output, calls, provider: provider.name };
        } catch (error) {
          lastError = error;
          if (NoObjectGeneratedError.isInstance(error)) {
            record('invalid_output', error.usage, error.text);
            if (attempt === 0) {
              messages = [
                ...messages,
                { role: 'assistant', content: error.text ?? '' },
                { role: 'user', content: REPAIR_INSTRUCTION },
              ];
              continue;
            }
          } else if (isServerSchemaRejection(error)) {
            // Strict-mode providers (Groq) validate server-side and answer 400 instead of
            // returning the bad JSON, so the repair re-ask quotes the validator's message.
            record('invalid_output');
            if (attempt === 0) {
              messages = [
                ...messages,
                {
                  role: 'user',
                  content: `${REPAIR_INSTRUCTION}\nValidator error: ${error.message.slice(0, MAX_REPAIR_ERROR_LENGTH)}`,
                },
              ];
              continue;
            }
          } else {
            record('error');
          }
          config.logger?.warn(
            { provider: provider.name, task: input.task, error: describeError(error) },
            'provider.fallback',
          );
          breaker.recordFailure(provider.name);
          break;
        }
      }
    }
    throw new LlmUnavailableError(input.task, calls, { cause: lastError });
  };
}
