import { languageForPath } from './chunker/languages.js';

/** Directories that are generated, vendored or tooling, never indexed (ADR-024). */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'vendor',
  'coverage',
  'target',
  '.git',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
]);

/** A line this long means generated or minified code: not worth embedding. */
export const MAX_LINE_LENGTH = 1_000;

export type IndexLimits = {
  maxFiles: number;
  maxFileBytes: number;
};

export type TreeEntry = { path: string; sha: string; size: number };

/** True when the path is code we chunk (by symbol or windows) and not generated/vendored. */
export function isIndexablePath(path: string, isIgnored: (path: string) => boolean): boolean {
  if (path.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return false;
  }
  if (/\.min\.[a-z]+$/.test(path) || isIgnored(path)) {
    return false;
  }
  return languageForPath(path).kind !== 'none';
}

/**
 * Indexable blobs, capped (sorted by path so the cut is deterministic). `isCapped` reports when
 * the repo had more indexable files than the cap.
 */
export function selectIndexableFiles(
  entries: readonly TreeEntry[],
  isIgnored: (path: string) => boolean,
  limits: IndexLimits,
): { files: TreeEntry[]; isCapped: boolean } {
  const candidates = entries
    .filter((entry) => entry.size <= limits.maxFileBytes && isIndexablePath(entry.path, isIgnored))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: candidates.slice(0, limits.maxFiles),
    isCapped: candidates.length > limits.maxFiles,
  };
}

export function looksMinified(source: string): boolean {
  return source.split('\n').some((line) => line.length > MAX_LINE_LENGTH);
}
