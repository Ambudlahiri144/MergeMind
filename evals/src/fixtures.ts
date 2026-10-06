import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toFileDiff } from '@mergemind/github';
import { FINDING_CATEGORIES, SEVERITIES, type FileDiff } from '@mergemind/shared';
import { z } from 'zod';

import { splitUnifiedDiff } from './patch.js';

export const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Seeded bugs use real categories only; `other` is too vague to benchmark (ADR-032). */
export const BENCHMARK_CATEGORIES = FINDING_CATEGORIES.filter((category) => category !== 'other');

export const ExpectedFindingSchema = z
  .object({
    path: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    category: z.enum(BENCHMARK_CATEGORIES),
    severity: z.enum(SEVERITIES),
  })
  .strict()
  .refine((finding) => finding.lineEnd >= finding.lineStart, 'lineEnd must be >= lineStart');
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;

export const FixtureMetaSchema = z
  .object({
    description: z.string().min(10),
    language: z.enum(['typescript', 'javascript', 'python']),
    expected: z.array(ExpectedFindingSchema).max(5),
  })
  .strict();

export type EvalFixture = {
  id: string;
  description: string;
  language: z.infer<typeof FixtureMetaSchema>['language'];
  files: FileDiff[];
  expected: ExpectedFinding[];
};

/** Head-side line numbers the diff adds to a file. */
export function addedLines(file: FileDiff): Set<number> {
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'added' && line.newLine !== null) {
        lines.add(line.newLine);
      }
    }
  }
  return lines;
}

export async function loadFixture(dir: string, id: string): Promise<EvalFixture> {
  const [patch, metaText] = await Promise.all([
    readFile(path.join(dir, id, 'diff.patch'), 'utf8'),
    readFile(path.join(dir, id, 'expected.json'), 'utf8'),
  ]);
  const meta = FixtureMetaSchema.parse(JSON.parse(metaText));
  return {
    id,
    description: meta.description,
    language: meta.language,
    files: splitUnifiedDiff(patch).map(toFileDiff),
    expected: meta.expected,
  };
}

/** Every fixture directory, sorted by id. */
export async function loadFixtures(dir: string = DEFAULT_FIXTURES_DIR): Promise<EvalFixture[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(ids.map((id) => loadFixture(dir, id)));
}
