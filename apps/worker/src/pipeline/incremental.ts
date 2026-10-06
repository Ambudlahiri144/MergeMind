import type { FindingView } from '@mergemind/db';
import type { DiffHunk, FileDiff } from '@mergemind/shared';

import { isSameIssue, type IssueRegion } from './post-process.js';

// Incremental re-review (PRD F5, ADR-023). Pure functions over parsed diffs:
// - the PR diff (base...head) is what reviewers see and what comments anchor to;
// - the compare diff (lastReviewedSha...head) says what changed since the last review.

/**
 * Head-side lines a push changed, per path: every added line, plus the context lines of a
 * deletion-only hunk (removing code changes the meaning of the code around it).
 */
export function changedHeadLines(compareFiles: readonly FileDiff[]): Map<string, Set<number>> {
  const changed = new Map<string, Set<number>>();
  for (const file of compareFiles) {
    if (file.status === 'removed') {
      continue;
    }
    const lines = new Set<number>();
    for (const hunk of file.hunks) {
      const added = hunk.lines.filter((line) => line.kind === 'added');
      const source =
        added.length > 0 ? added : hunk.lines.filter((line) => line.kind === 'context');
      for (const line of source) {
        if (line.newLine !== null) {
          lines.add(line.newLine);
        }
      }
    }
    if (lines.size > 0) {
      changed.set(file.path, lines);
    }
  }
  return changed;
}

/** The PR-diff hunks a push touched; files without such a hunk are dropped. */
export function scopeToChanges(
  prFiles: readonly FileDiff[],
  changed: ReadonlyMap<string, ReadonlySet<number>>,
): FileDiff[] {
  return prFiles.flatMap((file) => {
    const lines = changed.get(file.path);
    if (!lines) {
      return [];
    }
    const hunks = file.hunks.filter((hunk) =>
      hunk.lines.some((line) => line.newLine !== null && lines.has(line.newLine)),
    );
    return hunks.length > 0 ? [{ ...file, hunks }] : [];
  });
}

function oldRange(hunk: DiffHunk): { start: number; end: number } {
  // `-a,0` is an insertion *after* old line a: it occupies no old lines.
  return hunk.oldLines === 0
    ? { start: hunk.oldStart + 1, end: hunk.oldStart }
    : { start: hunk.oldStart, end: hunk.oldStart + hunk.oldLines - 1 };
}

/**
 * Where an old-side line ended up on the new side. Lines outside hunks shift by the net size
 * of the hunks above them; a removed line maps to the nearest surviving line of its hunk.
 */
export function mapOldLineToNew(file: FileDiff, oldLine: number): number {
  let delta = 0;
  for (const hunk of file.hunks) {
    const range = oldRange(hunk);
    if (oldLine < range.start) {
      break;
    }
    if (oldLine <= range.end) {
      const exact = hunk.lines.find((line) => line.oldLine === oldLine && line.newLine !== null);
      if (exact?.newLine != null) {
        return exact.newLine;
      }
      const index = hunk.lines.findIndex((line) => line.oldLine === oldLine);
      const after = hunk.lines.slice(index + 1).find((line) => line.newLine !== null);
      return after?.newLine ?? Math.max(1, hunk.newStart + hunk.newLines - 1);
    }
    delta += hunk.newLines - hunk.oldLines;
  }
  return Math.max(1, oldLine + delta);
}

/** True when the push changed code inside the finding's old range (or deleted its file). */
export function isFindingTouched(
  finding: Pick<FindingView, 'lineStart' | 'lineEnd'>,
  compareFile: FileDiff,
): boolean {
  if (compareFile.status === 'removed') {
    return true;
  }
  const isInside = (oldLine: number) => oldLine >= finding.lineStart && oldLine <= finding.lineEnd;
  return compareFile.hunks.some((hunk) => {
    // Old line after which the next added line is inserted; starts before the hunk's first line.
    let insertAfter = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    for (const line of hunk.lines) {
      if (line.kind === 'removed' && line.oldLine !== null && isInside(line.oldLine)) {
        return true;
      }
      if (line.kind === 'added' && isInside(insertAfter)) {
        return true;
      }
      if (line.oldLine !== null) {
        insertAfter = line.oldLine;
      }
    }
    return false;
  });
}

export type ResolutionInput = {
  openFindings: readonly FindingView[];
  compareFiles: readonly FileDiff[];
  /** This run's confident candidates on the new side (before suppression/dedupe). */
  currentIssues: readonly (IssueRegion & { fingerprint: string })[];
};

/**
 * Earlier findings this push fixed: their code changed (touched) and nothing in the new review
 * restates them at their new position. Untouched findings are never resolved, because a model
 * not re-reporting unchanged code proves nothing.
 */
export function findResolvedFindings(input: ResolutionInput): FindingView[] {
  const byOldPath = byPreviousPath(input.compareFiles);
  const currentFingerprints = new Set(input.currentIssues.map((issue) => issue.fingerprint));

  return input.openFindings.filter((finding) => {
    const compareFile = byOldPath.get(finding.path);
    if (!compareFile || !isFindingTouched(finding, compareFile)) {
      return false;
    }
    if (compareFile.status === 'removed') {
      return true;
    }
    if (currentFingerprints.has(finding.fingerprint)) {
      return false;
    }
    const moved = movedRegion(finding, compareFile);
    return !input.currentIssues.some((issue) => isSameIssue(issue, moved));
  });
}

function byPreviousPath(compareFiles: readonly FileDiff[]): Map<string, FileDiff> {
  const byOldPath = new Map<string, FileDiff>();
  for (const file of compareFiles) {
    byOldPath.set(file.previousPath ?? file.path, file);
  }
  return byOldPath;
}

function movedRegion(finding: FindingView, compareFile: FileDiff): IssueRegion {
  return {
    path: compareFile.path,
    category: finding.category,
    lineStart: mapOldLineToNew(compareFile, finding.lineStart),
    lineEnd: mapOldLineToNew(compareFile, finding.lineEnd),
  };
}

/**
 * Where earlier open findings sit at the new head, so a restatement by another pass (a new
 * fingerprint) is not posted again. Findings of deleted files are dropped; with no compare
 * diff (full review) positions are kept as stored.
 */
export function currentIssueRegions(
  openFindings: readonly FindingView[],
  compareFiles: readonly FileDiff[],
): IssueRegion[] {
  const byOldPath = byPreviousPath(compareFiles);
  return openFindings.flatMap((finding) => {
    const compareFile = byOldPath.get(finding.path);
    if (!compareFile) {
      const { path, category, lineStart, lineEnd } = finding;
      return [{ path, category, lineStart, lineEnd }];
    }
    return compareFile.status === 'removed' ? [] : [movedRegion(finding, compareFile)];
  });
}

export type IncrementalDecision =
  { mode: 'incremental'; compareFiles: FileDiff[] } | { mode: 'full'; reason: string };

export const COMPARE_FALLBACK_REASONS = {
  noBase: 'no earlier review of this PR',
  notSynchronize: 'not a push to the PR',
  unavailable: 'GitHub could not compare the commits (force-push or rewritten history)',
  notAhead: 'the last reviewed commit is no longer an ancestor (force-push or rebase)',
  truncated: 'the push changed 300 or more files',
} as const;

/** Added + removed lines in the given hunks (the size of an incremental review). */
export function countHunkChanges(files: readonly FileDiff[]): number {
  return files.reduce(
    (total, file) =>
      total +
      file.hunks.reduce(
        (sum, hunk) => sum + hunk.lines.filter((line) => line.kind !== 'context').length,
        0,
      ),
    0,
  );
}
