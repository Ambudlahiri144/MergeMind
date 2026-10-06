import type { CodeChunkHit } from '@mergemind/db';
import type { ContextSnippet } from '@mergemind/llm';

import type { ReviewChunk } from './chunk-hunks.js';

/** ~1,500 tokens of context per LLM call (ADR-025), at ~4 chars per token. */
export const MAX_CONTEXT_CHARS = 6_000;
export const VECTOR_RESULTS = 8;
export const NAME_RESULTS = 5;
const MAX_QUERY_CHARS = 2_000;
const MAX_CALLED_NAMES = 10;

/** Call-like words that are not functions worth looking up. */
const NOT_FUNCTIONS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'typeof',
  'await',
  'new',
  'super',
  'require',
  'import',
  'print',
  'len',
  'console',
  'log',
  'map',
  'filter',
  'push',
  'then',
  'expect',
]);

function addedLines(chunk: ReviewChunk): string[] {
  return chunk.files.flatMap((file) =>
    file.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.kind === 'added').map((line) => line.content),
    ),
  );
}

/** What the change does, as a retrieval query: its added lines (bounded). */
export function queryTextFor(chunk: ReviewChunk): string {
  return addedLines(chunk).join('\n').slice(0, MAX_QUERY_CHARS);
}

/** Functions the added lines call (`name(`), to fetch their definitions. */
export function extractCalledNames(chunk: ReviewChunk): string[] {
  const names = new Set<string>();
  for (const line of addedLines(chunk)) {
    for (const match of line.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[1];
      if (name !== undefined && !NOT_FUNCTIONS.has(name) && name.length > 2) {
        names.add(name);
      }
    }
  }
  return [...names].slice(0, MAX_CALLED_NAMES);
}

/** True when a hit is code the chunk itself is changing (the model already sees it). */
function overlapsOwnHunks(hit: CodeChunkHit, chunk: ReviewChunk): boolean {
  return chunk.files.some(
    (file) =>
      file.path === hit.path &&
      file.hunks.some(
        (hunk) => hit.startLine <= hunk.newStart + hunk.newLines && hunk.newStart <= hit.endLine,
      ),
  );
}

/**
 * Picks context for one review chunk (pure): definitions of called names first (exact matches),
 * then nearest neighbours by vector score; drops the chunk's own code and duplicates, and stays
 * within the character budget.
 */
export function selectContext(
  chunk: ReviewChunk,
  nameHits: readonly CodeChunkHit[],
  vectorHits: readonly CodeChunkHit[],
  budgetChars = MAX_CONTEXT_CHARS,
): ContextSnippet[] {
  const seen = new Set<string>();
  const selected: ContextSnippet[] = [];
  let used = 0;
  const ranked = [...nameHits, ...[...vectorHits].sort((a, b) => b.score - a.score)];
  for (const hit of ranked) {
    const key = `${hit.path}#${hit.symbol}`;
    if (seen.has(key) || overlapsOwnHunks(hit, chunk)) {
      continue;
    }
    seen.add(key);
    if (used + hit.content.length > budgetChars) {
      continue;
    }
    used += hit.content.length;
    selected.push({
      path: hit.path,
      symbol: hit.symbol,
      startLine: hit.startLine,
      endLine: hit.endLine,
      content: hit.content,
    });
  }
  return selected;
}
