import {
  FILE_DIFF_STATUSES,
  type DiffHunk,
  type DiffLine,
  type FileDiff,
  type FileDiffStatus,
} from '@mergemind/shared';

// `@@ -oldStart[,oldLines] +newStart[,newLines] @@ section`; a missing count means 1.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses GitHub's `patch` field (hunks only, no `diff --git` header) into hunks with base- and
 * head-side line numbers. `\ No newline at end of file` markers are skipped.
 */
export function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      const [, oldStart = '0', oldCount, newStart = '0', newCount] = header;
      current = {
        header: raw,
        oldStart: Number(oldStart),
        oldLines: oldCount === undefined ? 1 : Number(oldCount),
        newStart: Number(newStart),
        newLines: newCount === undefined ? 1 : Number(newCount),
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (current === undefined || raw.startsWith('\\')) {
      continue;
    }

    const marker = raw.charAt(0);
    const content = raw.slice(1);
    let line: DiffLine;
    if (marker === '+') {
      line = { kind: 'added', content, oldLine: null, newLine: newLine++ };
    } else if (marker === '-') {
      line = { kind: 'removed', content, oldLine: oldLine++, newLine: null };
    } else if (marker === ' ') {
      line = { kind: 'context', content, oldLine: oldLine++, newLine: newLine++ };
    } else {
      // A trailing empty string from the final newline, or noise; never a diff line.
      continue;
    }
    current.lines.push(line);
  }
  return hunks;
}

export type PullRequestFile = {
  filename: string;
  previous_filename?: string | undefined;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | undefined;
};

function toStatus(status: string): FileDiffStatus {
  return (FILE_DIFF_STATUSES as readonly string[]).includes(status)
    ? (status as FileDiffStatus)
    : 'modified';
}

export function toFileDiff(file: PullRequestFile): FileDiff {
  const hasPatch = typeof file.patch === 'string' && file.patch !== '';
  return {
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: toStatus(file.status),
    additions: file.additions,
    deletions: file.deletions,
    hunks: hasPatch ? parsePatch(file.patch ?? '') : [],
    hasPatch,
  };
}

/**
 * Head-side lines a review comment may target (added or context), mapped to their hunk index.
 * GitHub rejects the whole review if one comment points elsewhere.
 */
export function commentableLines(file: FileDiff): Map<number, number> {
  const lines = new Map<number, number>();
  file.hunks.forEach((hunk, hunkIndex) => {
    for (const line of hunk.lines) {
      if (line.newLine !== null) {
        lines.set(line.newLine, hunkIndex);
      }
    }
  });
  return lines;
}

/** Head-side source in [start, end] that appears in the diff (fingerprint input). */
export function headCodeInRange(file: FileDiff, start: number, end: number): string {
  return file.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.newLine !== null && line.newLine >= start && line.newLine <= end)
    .map((line) => line.content)
    .join('\n');
}

export function countChangedLines(files: readonly FileDiff[]): number {
  return files.reduce((total, file) => total + file.additions + file.deletions, 0);
}
