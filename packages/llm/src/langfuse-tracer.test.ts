import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { REDACTED, createLangfuseTracer } from './langfuse-tracer.js';
import type { LlmTraceEvent, LlmTracer } from './tracer.js';

const event: LlmTraceEvent = {
  runId: '66f0a1b2c3d4e5f601234567',
  task: 'review.security',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  promptVersion: 'security@1',
  outcome: 'ok',
  isFallback: false,
  latencyMs: 1200,
  inputTokens: 900,
  outputTokens: 150,
  system: 'You are a security reviewer.',
  user: 'File: src/users.ts SECRET_CODE_LINE',
  output: { findings: [{ title: 'SQL injection' }] },
  isPrivateRepo: false,
};

let tracer: LlmTracer | undefined;

function setup(isRedactingPrivateInputs = true) {
  const exporter = new InMemorySpanExporter();
  tracer = createLangfuseTracer({
    publicKey: 'pk-lf-test',
    secretKey: 'sk-lf-test',
    baseUrl: 'https://cloud.langfuse.com',
    isRedactingPrivateInputs,
    environment: 'test',
    exporter,
  });
  return { tracer, exporter };
}

/** All attribute values of a span, as one string, so assertions don't depend on key names. */
function attributeText(span: ReadableSpan): string {
  return JSON.stringify(span.attributes);
}

afterEach(async () => {
  await tracer?.shutdown();
  tracer = undefined;
});

describe('createLangfuseTracer', () => {
  it('exports one generation per call, grouped by run, with model, usage and timing', async () => {
    const { tracer: langfuse, exporter } = setup();

    langfuse.record(event);
    await langfuse.flush();

    const [span, ...rest] = exporter.getFinishedSpans();
    expect(rest).toHaveLength(0);
    expect(span?.name).toBe('review.security');
    const text = attributeText(span!);
    expect(text).toContain('generation');
    expect(text).toContain('openai/gpt-oss-120b');
    // One Langfuse session per review run.
    expect(span?.attributes['session.id']).toBe(event.runId);
    expect(text).toContain('900');
    expect(text).toContain('SECRET_CODE_LINE');
    const durationMs =
      (span!.endTime[0] - span!.startTime[0]) * 1000 +
      (span!.endTime[1] - span!.startTime[1]) / 1e6;
    expect(Math.round(durationMs)).toBe(1200);
  });

  it('sends metadata only for a private repo when redaction is on', async () => {
    const { tracer: langfuse, exporter } = setup(true);

    langfuse.record({ ...event, isPrivateRepo: true });
    await langfuse.flush();

    const text = attributeText(exporter.getFinishedSpans()[0]!);
    expect(text).not.toContain('SECRET_CODE_LINE');
    expect(text).not.toContain('SQL injection');
    expect(text).toContain(REDACTED);
    expect(text).toContain('900');
  });

  it('keeps private inputs when redaction is explicitly off', async () => {
    const { tracer: langfuse, exporter } = setup(false);

    langfuse.record({ ...event, isPrivateRepo: true });
    await langfuse.flush();

    expect(attributeText(exporter.getFinishedSpans()[0]!)).toContain('SECRET_CODE_LINE');
  });

  it('marks failed calls as warnings', async () => {
    const { tracer: langfuse, exporter } = setup();

    langfuse.record({ ...event, outcome: 'invalid_output' });
    await langfuse.flush();

    const text = attributeText(exporter.getFinishedSpans()[0]!);
    expect(text).toContain('WARNING');
    expect(text).toContain('invalid_output');
  });

  it('never throws from record, even for output it cannot serialize', async () => {
    const { tracer: langfuse } = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => {
      langfuse.record({ ...event, output: circular });
    }).not.toThrow();
    await langfuse.flush();
  });
});
