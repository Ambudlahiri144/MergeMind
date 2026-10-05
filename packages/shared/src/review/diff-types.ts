// Parsed diff shapes. They live in shared because packages/github produces them and
// packages/llm renders them, and those two packages must not import each other.

export type DiffLineKind = 'added' | 'removed' | 'context';

export type DiffLine = {
  kind: DiffLineKind;
  content: string;
  /** Line number on the base side; null for added lines. */
  oldLine: number | null;
  /** Line number on the head side; null for removed lines. Comments anchor here (side RIGHT). */
  newLine: number | null;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export const FILE_DIFF_STATUSES = [
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
] as const;
export type FileDiffStatus = (typeof FILE_DIFF_STATUSES)[number];

export type FileDiff = {
  path: string;
  previousPath: string | null;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** False when GitHub sent no patch (binary or very large file). */
  hasPatch: boolean;
};
