// Dev tool: runs one real review pass against the configured provider chain on a diff with a
// planted bug, and prints the validated findings and token usage. Needs GROQ_API_KEY and/or a
// running Ollama. Usage: npm run llm:smoke -- [security|correctness|maintainability]
import { parsePatch } from '@mergemind/github';
import {
  LlmUnavailableError,
  createLangfuseTracer,
  createProviderChain,
  noopTracer,
  createReviewLlm,
  type LlmCallRecord,
} from '@mergemind/llm';
import { REVIEW_PASSES, type ReviewPass } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';

const PATCH = `@@ -1,8 +1,12 @@
 import { db } from './db';

-export async function findUser(id: string) {
-  return db.users.findOne({ id });
+export async function findUser(req: Request) {
+  const id = new URL(req.url).searchParams.get('id');
+  const rows = await db.query("SELECT * FROM users WHERE id = '" + id + "'");
+  return rows[0].email;
 }

 export async function saveUser(user: User) {
-  await db.users.insert(user);
+  db.users.insert(user);
+  return true;
 }`;

function printCalls(calls: readonly LlmCallRecord[]): void {
  for (const call of calls) {
    console.log(
      `  call ${call.provider}/${call.model}: ${call.outcome}, ${call.inputTokens} in / ${call.outputTokens} out, ${call.latencyMs} ms`,
    );
  }
}

function readPass(value: string | undefined): ReviewPass {
  if (value === undefined) {
    return 'security';
  }
  if ((REVIEW_PASSES as readonly string[]).includes(value)) {
    return value as ReviewPass;
  }
  throw new Error(`Unknown pass "${value}". Use one of: ${REVIEW_PASSES.join(', ')}`);
}

async function main(): Promise<void> {
  const pass = readPass(process.argv[2]);
  const env = process.env;
  const providers = createProviderChain({
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    primaryModel: env.LLM_PRIMARY_MODEL ?? 'openai/gpt-oss-120b',
    localModel: env.LLM_LOCAL_MODEL ?? 'qwen2.5-coder:7b',
    ...(env.GROQ_API_KEY ? { groqApiKey: env.GROQ_API_KEY } : {}),
    ...(env.GOOGLE_GENERATIVE_AI_API_KEY && env.LLM_FALLBACK_MODEL
      ? { googleApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, fallbackModel: env.LLM_FALLBACK_MODEL }
      : {}),
  });
  console.log(`Providers: ${providers.map((p) => `${p.name}(${p.modelId})`).join(' -> ')}`);

  // Traces to Langfuse when both keys are set (session id = runId below).
  const tracer =
    env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
      ? createLangfuseTracer({
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
          isRedactingPrivateInputs: true,
          environment: 'smoke',
        })
      : noopTracer;
  const runId = `smoke-${Date.now()}`;
  const llm = createReviewLlm({
    providers,
    tracer,
    // Shows each provider.fallback with the underlying error.
    logger: createLogger({ name: 'llm-smoke', level: 'warn' }),
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 45_000),
  });
  const result = await llm.reviewPass({
    runId,
    pass,
    persona: 'Senior backend reviewer. Concise. Cite exact lines.',
    isPrivateRepo: false,
    allowedProviders: ['groq', 'gemini', 'ollama'],
    files: [{ path: 'src/users.ts', previousPath: null, hunks: parsePatch(PATCH) }],
  });

  console.log(`\n${pass} pass answered by ${result.provider} (${result.promptVersion})`);
  printCalls(result.calls);
  await tracer.shutdown();
  console.log(tracer === noopTracer ? 'Langfuse: off' : `Langfuse: flushed, session ${runId}`);
  console.log(`\n${result.findings.length} finding(s):`);
  for (const finding of result.findings) {
    console.log(
      `- [${finding.severity} ${finding.confidence.toFixed(2)} ${finding.category}] ${finding.path}:${finding.lineStart}-${finding.lineEnd} ${finding.title}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  if (error instanceof LlmUnavailableError) {
    printCalls(error.calls);
  }
  if (error instanceof Error && error.cause !== undefined) {
    console.error('cause:', error.cause instanceof Error ? error.cause.message : error.cause);
  }
  process.exitCode = 1;
});
