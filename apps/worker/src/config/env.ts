import {
  BooleanFlagSchema,
  LogLevelSchema,
  MongoUriSchema,
  NodeEnvSchema,
  RedisUrlSchema,
  parseEnv,
} from '@mergemind/shared';
import { z } from 'zod';

// Queue concurrency defaults from Architecture.md §5.
const DEFAULT_REVIEW_CONCURRENCY = 4;
const DEFAULT_INDEX_CONCURRENCY = 1;
const DEFAULT_CI_SUMMARY_CONCURRENCY = 2;
const MAX_CONCURRENCY = 32;

// LLM defaults from Architecture.md §6.
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_CHUNK_TOKENS = 6000;
const MIN_CHUNK_TOKENS = 500;
const MAX_CHUNK_TOKENS = 100_000;
const DEFAULT_PASS_CONCURRENCY = 3;
const MAX_PASS_CONCURRENCY = 16;

// Index caps (ADR-024): keep a repo's chunks well inside Atlas M0's 512 MB.
const DEFAULT_INDEX_MAX_FILES = 1_500;
const MAX_INDEX_FILES_LIMIT = 10_000;
const DEFAULT_INDEX_MAX_FILE_BYTES = 200_000;
const MAX_INDEX_FILE_BYTES_LIMIT = 1_000_000;

const ConcurrencySchema = (fallback: number, max = MAX_CONCURRENCY) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

export const WorkerEnvSchema = z
  .object({
    NODE_ENV: NodeEnvSchema,
    LOG_LEVEL: LogLevelSchema,
    MONGODB_URI: MongoUriSchema,
    REDIS_URL: RedisUrlSchema,
    REVIEW_CONCURRENCY: ConcurrencySchema(DEFAULT_REVIEW_CONCURRENCY),
    INDEX_CONCURRENCY: ConcurrencySchema(DEFAULT_INDEX_CONCURRENCY),
    CI_SUMMARY_CONCURRENCY: ConcurrencySchema(DEFAULT_CI_SUMMARY_CONCURRENCY),

    // GitHub App: optional so `npm run dev` works before the App exists; reviews need both.
    GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .min(1)
      .transform((pem) => pem.replace(/\\n/g, '\n'))
      .optional(),

    // LLM providers: each key optional; Ollama is always in the chain (ADR-007).
    GROQ_API_KEY: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
    LLM_PRIMARY_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
    LLM_FALLBACK_MODEL: z.string().min(1).optional(),
    LLM_LOCAL_MODEL: z.string().min(1).default('qwen2.5-coder:7b'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_LLM_TIMEOUT_MS),
    LLM_CHUNK_TOKENS: z.coerce
      .number()
      .int()
      .min(MIN_CHUNK_TOKENS)
      .max(MAX_CHUNK_TOKENS)
      .default(DEFAULT_CHUNK_TOKENS),
    LLM_PASS_CONCURRENCY: ConcurrencySchema(DEFAULT_PASS_CONCURRENCY, MAX_PASS_CONCURRENCY),

    // Code index (PRD F6, ADR-024): local Ollama embeddings, capped per repo. Off on hosts with
    // no room for Ollama (ADR-038): index jobs are then skipped, and reviews run without context.
    INDEX_ENABLED: BooleanFlagSchema.default(true),
    // Ephemeral hosts lose the Redis queue on restart: re-enqueue reviews still owed (ADR-038).
    RECONCILE_ON_BOOT: BooleanFlagSchema.default(false),
    EMBEDDING_MODEL: z.string().min(1).default('nomic-embed-text'),
    INDEX_MAX_FILES: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_INDEX_FILES_LIMIT)
      .default(DEFAULT_INDEX_MAX_FILES),
    INDEX_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(MAX_INDEX_FILE_BYTES_LIMIT)
      .default(DEFAULT_INDEX_MAX_FILE_BYTES),

    // Langfuse (ADR-010): tracing is on only when both keys are set.
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_BASE_URL: z.url().default('https://cloud.langfuse.com'),
    LANGFUSE_REDACT_INPUTS: BooleanFlagSchema.default(true),
  })
  .refine(
    (env) => (env.LANGFUSE_PUBLIC_KEY === undefined) === (env.LANGFUSE_SECRET_KEY === undefined),
    {
      message: 'Set both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY, or neither',
      path: ['LANGFUSE_PUBLIC_KEY'],
    },
  )
  .refine(
    (env) => (env.GITHUB_APP_ID === undefined) === (env.GITHUB_APP_PRIVATE_KEY === undefined),
    {
      message: 'Set both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or neither',
      path: ['GITHUB_APP_ID'],
    },
  );

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(WorkerEnvSchema, source);
}
