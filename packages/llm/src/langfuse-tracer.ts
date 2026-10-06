import type { Logger } from '@mergemind/shared/logger';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  LangfuseOtelSpanAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from '@langfuse/tracing';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import type { LlmTraceEvent, LlmTracer } from './tracer.js';

export const REDACTED = '[redacted: private repository]';

export type LangfuseTracerOptions = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  /**
   * `LANGFUSE_REDACT_INPUTS`: for private repos, send metadata only (model, tokens, latency,
   * outcome), never prompts, code or output (ADR-010).
   */
  isRedactingPrivateInputs: boolean;
  environment?: string;
  logger?: Logger;
  /** Tests inject an in-memory exporter instead of the Langfuse HTTP exporter. */
  exporter?: SpanExporter;
};

function shouldRedact(event: LlmTraceEvent, options: LangfuseTracerOptions): boolean {
  return event.isPrivateRepo && options.isRedactingPrivateInputs;
}

/**
 * Langfuse adapter for `LlmTracer` (ADR-010, ADR-022). One generation per LLM call, grouped into a
 * session per review run, using Langfuse SDK v5 (OpenTelemetry). The provider is registered only
 * with Langfuse (`setLangfuseTracerProvider`), never as the global OTel provider.
 */
export function createLangfuseTracer(options: LangfuseTracerOptions): LlmTracer {
  const processor = new LangfuseSpanProcessor({
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    baseUrl: options.baseUrl,
    ...(options.exporter === undefined ? {} : { exporter: options.exporter }),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  setLangfuseTracerProvider(provider);

  return {
    record(event) {
      try {
        const isRedacted = shouldRedact(event, options);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - event.latencyMs);
        const generation = startObservation(
          event.task,
          {
            model: event.model,
            version: event.promptVersion,
            input: isRedacted
              ? REDACTED
              : [
                  { role: 'system', content: event.system },
                  { role: 'user', content: event.user },
                ],
            output: isRedacted ? REDACTED : event.output,
            usageDetails: { input: event.inputTokens, output: event.outputTokens },
            level: event.outcome === 'ok' ? 'DEFAULT' : 'WARNING',
            ...(event.outcome === 'ok' ? {} : { statusMessage: event.outcome }),
            ...(options.environment === undefined ? {} : { environment: options.environment }),
            metadata: {
              runId: event.runId,
              provider: event.provider,
              outcome: event.outcome,
              isFallback: event.isFallback,
              isPrivateRepo: event.isPrivateRepo,
              isRedacted,
            },
          },
          { asType: 'generation', startTime },
        );
        // Trace-level attributes set on the span itself: one Langfuse session per review run.
        // (propagateAttributes would need a global OTel context manager, which we don't install.)
        generation.otelSpan.setAttributes({
          [LangfuseOtelSpanAttributes.TRACE_SESSION_ID]: event.runId,
          [LangfuseOtelSpanAttributes.TRACE_NAME]: event.task,
          [LangfuseOtelSpanAttributes.TRACE_TAGS]: [...event.task.split('.'), event.provider],
        });
        generation.end(endTime);
      } catch (error) {
        // Tracing must never fail a review; the call itself already succeeded or failed.
        options.logger?.warn({ err: error, runId: event.runId }, 'langfuse.recordFailed');
      }
    },
    flush: () => processor.forceFlush(),
    shutdown: async () => {
      await provider.shutdown();
      setLangfuseTracerProvider(null);
    },
  };
}
