import { createHash } from 'node:crypto';

import type { ReviewPass } from '../domain.js';

export type FingerprintInput = {
  pass: ReviewPass;
  path: string;
  /** Head-side source lines the finding covers (empty when outside the diff). */
  code: string;
  title: string;
};

/** Whitespace-insensitive, so re-indentation and line shifts keep the same identity. */
export function normalizeCode(code: string): string {
  return code
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line !== '')
    .join('\n');
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable identity of a finding across runs (Architecture.md §4): drives "never post twice",
 * suppressions and (Phase 4) resolution. Line numbers are deliberately not part of it.
 */
export function computeFingerprint({ pass, path, code, title }: FingerprintInput): string {
  return createHash('sha256')
    .update([pass, path, normalizeCode(code), slugifyTitle(title)].join('\u0000'))
    .digest('hex');
}
