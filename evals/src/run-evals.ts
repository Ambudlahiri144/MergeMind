// Seeded-bug benchmark (PRD §7, Testing.md §4, ADR-032): every fixture goes through the same
// stages a real review uses (chunking, the three passes on the production provider chain,
// anchoring, cross-pass merge, confidence filter), then the kept findings are scored.
//
//   npm run eval                      all fixtures
//   npm run eval -- --only a,b        selected fixture ids
//   npm run eval -- --max-fixtures 5  a quick, quota-friendly smoke
//   npm run eval -- --tpm 7000        tokens per minute to stay under (Groq free: 8,000)
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createProviderChain, createReviewLlm, promptVersionFor } from '@mergemind/llm';
import {
  DEFAULT_ALLOWED_PROVIDERS,
  DEFAULT_POLICY,
  REVIEW_PASSES,
  type FileDiff,
} from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';

// The worker's pure pipeline stages, imported by path: the benchmark must run exactly what a
// review runs (a tooling exception like apps/web/e2e/stack.ts; nothing ships from here).
import { chunkFiles } from '../../apps/worker/src/pipeline/chunk-hunks.js';
import { classifyFindings, prepareFindings } from '../../apps/worker/src/pipeline/post-process.js';
import { runPasses } from '../../apps/worker/src/pipeline/run-passes.js';
import { loadFixtures, type EvalFixture } from './fixtures.js';
import type { ReportedFinding } from './match.js';
import { scoreFixture, summarize, type FixtureOutcome } from './metrics.js';
import { TokenWindow } from './pacer.js';

const CHUNK_TOKENS = 6000;
const PASS_CONCURRENCY = 3;
const MAX_INLINE_COMMENTS = 25;
/** A failed fixture waits out the circuit breaker (60 s) and the token window, then retries. */
const RETRY_DELAY_MS = 65_000;
const MAX_RETRIES = 2;
const FIRST_ESTIMATE_TOKENS = 6000;
const REPORTS_DIR = fileURLToPath(new URL('../reports/', import.meta.url));

const logger = createLogger({ name: 'evals', level: process.env.LOG_LEVEL ?? 'info' });

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    tpm: { type: 'string', default: process.env.EVAL_TOKENS_PER_MINUTE ?? '7000' },
    'max-fixtures': { type: 'string' },
  },
});

const providers = createProviderChain({
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  primaryModel: process.env.LLM_PRIMARY_MODEL ?? 'openai/gpt-oss-120b',
  localModel: process.env.LLM_LOCAL_MODEL ?? 'qwen2.5-coder:7b',
  ...(process.env.GROQ_API_KEY ? { groqApiKey: process.env.GROQ_API_KEY } : {}),
  ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.LLM_FALLBACK_MODEL
    ? {
        googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        fallbackModel: process.env.LLM_FALLBACK_MODEL,
      }
    : {}),
});
const llm = createReviewLlm({
  providers,
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
  logger,
});
const promptVersion = promptVersionFor(REVIEW_PASSES);

type FixtureRun = FixtureOutcome & {
  tokens: { input: number; output: number };
  calls: number;
  fallbackCalls: number;
  providersUsed: string[];
};

function categoryOf(fixture: EvalFixture): string {
  return fixture.expected[0]?.category ?? 'clean';
}

async function runFixture(fixture: EvalFixture): Promise<FixtureRun> {
  const filesByPath = new Map<string, FileDiff>(fixture.files.map((file) => [file.path, file]));
  const result = await runPasses(llm, {
    runId: `eval-${fixture.id}`,
    passes: REVIEW_PASSES,
    chunks: chunkFiles(fixture.files, CHUNK_TOKENS),
    persona: DEFAULT_POLICY.persona,
    isPrivateRepo: false,
    allowedProviders: DEFAULT_ALLOWED_PROVIDERS,
    concurrency: PASS_CONCURRENCY,
  });
  const { prepared } = prepareFindings(result.findings, filesByPath);
  const { toStore } = classifyFindings(prepared, {
    suppressed: new Set(),
    alreadyReported: new Set(),
    openIssues: [],
    minConfidence: DEFAULT_POLICY.review.minConfidence,
    maxInlineComments: MAX_INLINE_COMMENTS,
  });
  const reported: ReportedFinding[] = toStore
    .filter((finding) => finding.state === 'open')
    .map((finding) => ({
      path: finding.path,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      category: finding.category,
      severity: finding.severity,
      pass: finding.pass,
      title: finding.title,
      confidence: finding.confidence,
    }));
  const ok = result.calls.filter((call) => call.outcome === 'ok');
  return {
    id: fixture.id,
    category: categoryOf(fixture),
    reported,
    expected: fixture.expected,
    isFailed: result.failedPasses.length > 0,
    tokens: result.calls.reduce(
      (total, call) => ({
        input: total.input + call.inputTokens,
        output: total.output + call.outputTokens,
      }),
      { input: 0, output: 0 },
    ),
    calls: result.calls.length,
    fallbackCalls: ok.filter((call) => call.isFallback).length,
    providersUsed: [...new Set(ok.map((call) => `${call.provider}:${call.model}`))],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One fixture at a time, paced by a rolling token window; a fixture whose passes failed is
 * retried after the breaker cooldown, so quota hiccups do not count as review misses.
 */
async function runAll(
  fixtures: readonly EvalFixture[],
  tokensPerMinute: number,
): Promise<FixtureRun[]> {
  const window = new TokenWindow(tokensPerMinute);
  const results: FixtureRun[] = [];
  let estimate = FIRST_ESTIMATE_TOKENS;
  for (const fixture of fixtures) {
    let run: FixtureRun | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const waitMs = window.waitMsFor(estimate);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      run = await runFixture(fixture);
      const spent = run.tokens.input + run.tokens.output;
      window.record(spent);
      estimate = Math.max(spent, FIRST_ESTIMATE_TOKENS / 2);
      if (!run.isFailed) {
        break;
      }
      if (attempt < MAX_RETRIES) {
        logger.warn({ fixture: fixture.id, attempt: attempt + 1 }, 'eval.fixtureRetry');
        await sleep(RETRY_DELAY_MS);
      }
    }
    if (!run) {
      continue;
    }
    results.push(run);
    const score = scoreFixture(run);
    logger.info(
      {
        fixture: fixture.id,
        tp: score.truePositives,
        fp: score.falsePositives,
        fn: score.falseNegatives,
        minor: score.minorNoise,
        failed: run.isFailed,
        tokens: run.tokens.input + run.tokens.output,
      },
      'eval.fixture',
    );
  }
  return results;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(runs: readonly FixtureRun[], summary: ReturnType<typeof summarize>) {
  const lines = [
    '',
    `MergeMind seeded-bug benchmark · prompts ${promptVersion}`,
    `fixtures ${String(summary.fixtures)} (${String(summary.failedFixtures)} failed) · providers ${[...new Set(runs.flatMap((run) => run.providersUsed))].join(', ') || 'none'}`,
    '',
    `precision ${percent(summary.precision.value)} (target ${percent(summary.precision.target)}) ${summary.precision.isPassed ? 'PASS' : 'FAIL'}`,
    `recall    ${percent(summary.recall.value)} (target ${percent(summary.recall.target)}) ${summary.recall.isPassed ? 'PASS' : 'FAIL'}`,
    `tp ${String(summary.truePositives)} · fp ${String(summary.falsePositives)} · fn ${String(summary.falseNegatives)} · minor noise ${String(summary.minorNoise)} · reports on clean fixtures ${String(summary.cleanFixtureReports)}`,
    '',
    'recall by category',
    ...Object.entries(summary.byCategory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([category, { expected, found }]) =>
          `  ${category.padEnd(18)} ${String(found)}/${String(expected)}`,
      ),
    '',
    summary.isPassed ? 'BENCHMARK PASSED' : 'BENCHMARK FAILED',
    '',
  ];
  process.stdout.write(lines.join('\n'));
}

async function main() {
  let fixtures = await loadFixtures();
  if (args.only) {
    const wanted = new Set(args.only.split(',').map((id) => id.trim()));
    fixtures = fixtures.filter((fixture) => wanted.has(fixture.id));
  }
  if (args['max-fixtures']) {
    fixtures = fixtures.slice(0, Number(args['max-fixtures']));
  }
  if (fixtures.length === 0) {
    throw new Error('No fixtures selected');
  }
  logger.info(
    {
      fixtures: fixtures.length,
      promptVersion,
      providers: providers.map((provider) => `${provider.name}:${provider.modelId}`),
    },
    'eval.started',
  );
  const startedAt = Date.now();
  const runs = await runAll(fixtures, Number(args.tpm));
  const summary = summarize(runs);
  const tokens = runs.reduce(
    (total, run) => ({
      input: total.input + run.tokens.input,
      output: total.output + run.tokens.output,
    }),
    { input: 0, output: 0 },
  );

  await mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = `${REPORTS_DIR}${stamp}-${promptVersion.replace(/[^a-z0-9@.-]+/gi, '_')}.json`;
  await writeFile(
    file,
    `${JSON.stringify(
      {
        promptVersion,
        isPartial: fixtures.length < (await loadFixtures()).length,
        durationMs: Date.now() - startedAt,
        tokens,
        calls: runs.reduce((total, run) => total + run.calls, 0),
        fallbackCalls: runs.reduce((total, run) => total + run.fallbackCalls, 0),
        summary,
        fixtures: runs.map((run) => ({ ...run, score: scoreFixture(run) })),
      },
      null,
      2,
    )}\n`,
  );
  printSummary(runs, summary);
  logger.info({ report: file, tokens }, 'eval.finished');
  process.exitCode = summary.isPassed ? 0 : 1;
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'eval.crashed');
  process.exitCode = 1;
});
