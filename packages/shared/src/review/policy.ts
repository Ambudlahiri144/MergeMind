import picomatch from 'picomatch';
import { parseDocument } from 'yaml';
import { z } from 'zod';

import { REVIEW_PASSES, type ReviewPass } from '../domain.js';

export const POLICY_FILE_PATH = '.mergemind.yml';
/** A policy file larger than this is rejected rather than parsed. */
export const MAX_POLICY_FILE_BYTES = 64 * 1024;
const MAX_IGNORE_PATHS = 100;
const MAX_PERSONA_LENGTH = 500;
const MAX_CHANGED_LINES_LIMIT = 100_000;

export const GATE_FAIL_ON = ['critical', 'major', 'never'] as const;
export type GateFailOn = (typeof GATE_FAIL_ON)[number];

export type ReviewPolicy = {
  version: 1;
  review: {
    enabled: boolean;
    passes: ReviewPass[];
    minConfidence: number;
    maxChangedLines: number;
    skipDrafts: boolean;
    ignorePaths: string[];
  };
  gate: { failOn: GateFailOn };
  ciSummary: { enabled: boolean };
  persona: string;
};

/** Safe defaults (Architecture.md §6). Applied whole when the file is missing or invalid. */
export const DEFAULT_POLICY: ReviewPolicy = {
  version: 1,
  review: {
    enabled: true,
    passes: [...REVIEW_PASSES],
    minConfidence: 0.7,
    maxChangedLines: 1500,
    skipDrafts: true,
    ignorePaths: [
      '**/*.lock',
      '**/package-lock.json',
      'dist/**',
      '**/*.min.js',
      '**/__snapshots__/**',
    ],
  },
  gate: { failOn: 'critical' },
  ciSummary: { enabled: true },
  persona: 'Senior backend reviewer. Concise. Cite exact lines.',
};

/** Every key is optional; unknown keys are errors so typos never pass silently. */
const PolicyFileSchema = z
  .object({
    version: z.literal(1),
    review: z
      .object({
        enabled: z.boolean(),
        passes: z.array(z.enum(REVIEW_PASSES)).min(1),
        minConfidence: z.number().min(0).max(1),
        maxChangedLines: z.number().int().positive().max(MAX_CHANGED_LINES_LIMIT),
        skipDrafts: z.boolean(),
        ignorePaths: z.array(z.string().min(1)).max(MAX_IGNORE_PATHS),
      })
      .partial()
      .strict(),
    gate: z
      .object({ failOn: z.enum(GATE_FAIL_ON) })
      .partial()
      .strict(),
    ciSummary: z.object({ enabled: z.boolean() }).partial().strict(),
    persona: z.string().min(1).max(MAX_PERSONA_LENGTH),
  })
  .partial()
  .strict();

type PolicyFile = z.infer<typeof PolicyFileSchema>;

export type PolicyResult = {
  policy: ReviewPolicy;
  /** `file` when the repo's file was valid and applied; `default` otherwise. */
  source: 'file' | 'default';
  /** Human-readable problems, shown in the review summary (PRD F7). */
  errors: string[];
};

type DefinedOnly<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drops undefined values so spreading over defaults can never erase a default. */
function definedOnly<T extends object>(value: T | undefined): DefinedOnly<T> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as DefinedOnly<T>;
}

function mergeWithDefaults(file: PolicyFile): ReviewPolicy {
  return {
    version: 1,
    // A file's ignorePaths list replaces the defaults, so a repo can opt files back in.
    review: { ...DEFAULT_POLICY.review, ...definedOnly(file.review) },
    gate: { ...DEFAULT_POLICY.gate, ...definedOnly(file.gate) },
    ciSummary: { ...DEFAULT_POLICY.ciSummary, ...definedOnly(file.ciSummary) },
    persona: file.persona ?? DEFAULT_POLICY.persona,
  };
}

const defaultResult = (errors: string[]): PolicyResult => ({
  policy: DEFAULT_POLICY,
  source: 'default',
  errors,
});

/**
 * Parses `.mergemind.yml` text (null when the file does not exist). Any problem means the whole
 * file is ignored and defaults apply; partial application would make behavior hard to predict.
 */
export function parsePolicy(text: string | null): PolicyResult {
  if (text === null) {
    return defaultResult([]);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_POLICY_FILE_BYTES) {
    return defaultResult([`${POLICY_FILE_PATH} is larger than ${MAX_POLICY_FILE_BYTES} bytes`]);
  }

  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return defaultResult(
      document.errors.map((error) => `YAML: ${error.message.split('\n')[0] ?? ''}`),
    );
  }
  const raw: unknown = document.toJS() ?? {};

  const result = PolicyFileSchema.safeParse(raw);
  if (!result.success) {
    return defaultResult(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return { policy: mergeWithDefaults(result.data), source: 'file', errors: [] };
}

/** Returns a predicate that is true for paths the policy says to skip. */
export function createIgnoreMatcher(ignorePaths: readonly string[]): (path: string) => boolean {
  if (ignorePaths.length === 0) {
    return () => false;
  }
  const isMatch = picomatch([...ignorePaths], { dot: true });
  return (path) => isMatch(path);
}
