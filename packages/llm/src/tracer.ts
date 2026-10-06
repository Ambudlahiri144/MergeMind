import type { LlmProviderName } from '@mergemind/shared';

export type LlmCallOutcome = 'ok' | 'invalid_output' | 'error';

export type LlmTraceEvent = {
  runId: string;
  /** What the call was for: `review.<pass>` or `ci-summary`; becomes the Langfuse trace name. */
  task: string;
  provider: LlmProviderName;
  model: string;
  promptVersion: string;
  outcome: LlmCallOutcome;
  isFallback: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Prompts and output; a tracer for private repos may drop these (LANGFUSE_REDACT_INPUTS). */
  system: string;
  user: string;
  output: unknown;
  isPrivateRepo: boolean;
};

/**
 * Observability sink for every LLM call (rules.md §7). Implementations must not throw and must
 * not block the call; the Langfuse adapter buffers spans and exports them in the background.
 */
export type LlmTracer = {
  record(event: LlmTraceEvent): void;
  /** Exports everything buffered so far. */
  flush(): Promise<void>;
  /** Flushes, then releases exporters; call once on process shutdown. */
  shutdown(): Promise<void>;
};

export const noopTracer: LlmTracer = {
  record: () => undefined,
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};
