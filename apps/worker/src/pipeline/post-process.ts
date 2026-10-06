import type { FindingPlacement, NewFinding, RunCounts } from '@mergemind/db';
import {
  anchorFinding,
  commentableLines,
  headCodeInRange,
  type CommentAnchor,
} from '@mergemind/github';
import {
  compareFindings,
  computeFingerprint,
  SEVERITY_RANK,
  type CandidateFinding,
  type FileDiff,
  type Severity,
} from '@mergemind/shared';

export type PreparedFinding = CandidateFinding & {
  fingerprint: string;
  anchor: CommentAnchor | null;
};

/**
 * Stage 10a (pure): drop findings on files outside the diff, anchor each one to commentable
 * lines, fingerprint it, and keep one finding per fingerprint (the most severe, most confident).
 */
export function prepareFindings(
  candidates: readonly CandidateFinding[],
  filesByPath: ReadonlyMap<string, FileDiff>,
): { prepared: PreparedFinding[]; droppedCount: number } {
  const byFingerprint = new Map<string, PreparedFinding>();
  let droppedCount = 0;

  for (const candidate of candidates) {
    const file = filesByPath.get(candidate.path);
    if (!file) {
      droppedCount += 1;
      continue;
    }
    const fingerprint = computeFingerprint({
      pass: candidate.pass,
      path: candidate.path,
      code: headCodeInRange(file, candidate.lineStart, candidate.lineEnd),
      title: candidate.title,
    });
    const prepared: PreparedFinding = {
      ...candidate,
      fingerprint,
      anchor: anchorFinding(candidate, commentableLines(file)),
    };
    const existing = byFingerprint.get(fingerprint);
    if (!existing || compareFindings(prepared, existing) < 0) {
      byFingerprint.set(fingerprint, prepared);
    }
  }
  return { prepared: [...byFingerprint.values()].sort(compareFindings), droppedCount };
}

export type ClassifyOptions = {
  suppressed: ReadonlySet<string>;
  /** Fingerprints this PR already has from an earlier run. */
  alreadyReported: ReadonlySet<string>;
  /** Open findings from earlier runs at their head-side lines (cross-run restatements). */
  openIssues: readonly IssueRegion[];
  minConfidence: number;
  maxInlineComments: number;
};

export type Classification = {
  /** New findings to persist: `open` ones are published, `filtered` ones are kept for analysis. */
  toStore: NewFinding[];
  /** Severity counts cover every open finding still present (new and already reported). */
  counts: RunCounts;
};

/** Two findings this close in the same file and category describe one issue. */
export const MERGE_LINE_TOLERANCE = 2;

/** Where an issue sits: enough to tell whether two reports describe the same one. */
export type IssueRegion = Pick<PreparedFinding, 'path' | 'category' | 'lineStart' | 'lineEnd'>;

type ClaimedRegion = IssueRegion;

/**
 * Categories that describe the same issue when they land on the same lines: unchecked input
 * flowing into a query *is* the injection. Only used to decide merges; stored categories
 * stay as the model reported them.
 */
const MERGE_FAMILY: Partial<Record<PreparedFinding['category'], string>> = {
  injection: 'tainted-input',
  'unchecked-input': 'tainted-input',
};

function mergeFamily(category: PreparedFinding['category']): string {
  return MERGE_FAMILY[category] ?? category;
}

/**
 * True when `finding` restates an issue already kept: same file, same category, overlapping
 * lines (± tolerance). Different passes often report one bug (e.g. SQL injection from both
 * security and correctness); fingerprints include the pass, so this is the cross-pass merge
 * (ADR-021). `other` is too broad to merge on.
 */
export function isSameIssue(a: IssueRegion, b: IssueRegion): boolean {
  return (
    a.category !== 'other' &&
    a.path === b.path &&
    mergeFamily(a.category) === mergeFamily(b.category) &&
    a.lineStart <= b.lineEnd + MERGE_LINE_TOLERANCE &&
    b.lineStart <= a.lineEnd + MERGE_LINE_TOLERANCE
  );
}

function isRestatement(finding: PreparedFinding, claimed: readonly ClaimedRegion[]): boolean {
  return claimed.some((region) => isSameIssue(finding, region));
}

function placementFor(finding: PreparedFinding, inlineSlotsLeft: number): FindingPlacement {
  const isInlineSeverity = SEVERITY_RANK[finding.severity] > SEVERITY_RANK.minor;
  return isInlineSeverity && finding.anchor !== null && inlineSlotsLeft > 0 ? 'inline' : 'summary';
}

/**
 * Stage 10b-11 (pure): suppressions, confidence filter, cross-pass merge, "never post twice",
 * and placement (critical/major inline up to the cap; minor, outside-diff and overflow in the
 * body; ADR-020, ADR-021). `prepared` must be sorted strongest first (`prepareFindings` does),
 * so the kept finding of a merged group is the most severe, most confident one.
 */
export function classifyFindings(
  prepared: readonly PreparedFinding[],
  options: ClassifyOptions,
): Classification {
  const counts: RunCounts = {
    critical: 0,
    major: 0,
    minor: 0,
    suppressed: 0,
    filtered: 0,
    duplicate: 0,
    merged: 0,
    resolved: 0,
  };
  const toStore: NewFinding[] = [];
  // Regions of issues already accounted for this run: posted, already reported, or suppressed.
  const claimed: ClaimedRegion[] = [];
  let inlineSlotsLeft = options.maxInlineComments;

  for (const finding of prepared) {
    const isConfident = finding.confidence >= options.minConfidence;
    if (isConfident && isRestatement(finding, claimed)) {
      counts.merged += 1;
      continue;
    }
    if (options.suppressed.has(finding.fingerprint)) {
      counts.suppressed += 1;
      claimed.push(finding);
      continue;
    }
    const isReported =
      options.alreadyReported.has(finding.fingerprint) ||
      (isConfident && isRestatement(finding, options.openIssues));
    if (isReported) {
      if (isConfident) {
        counts.duplicate += 1;
        counts[finding.severity] += 1;
        claimed.push(finding);
      }
      continue;
    }
    const { anchor, ...rest } = finding;
    if (!isConfident) {
      counts.filtered += 1;
      toStore.push({ ...rest, state: 'filtered', placement: 'summary' });
      continue;
    }
    const placement = placementFor(finding, inlineSlotsLeft);
    if (placement === 'inline') {
      inlineSlotsLeft -= 1;
    }
    counts[finding.severity] += 1;
    claimed.push(finding);
    toStore.push({ ...rest, state: 'open', placement });
  }
  return { toStore, counts };
}

/** Severities that count toward the gate, rebuilt from counts (works for resumed runs too). */
export function gateSeverities(counts: RunCounts): { severity: Severity }[] {
  return (['critical', 'major', 'minor'] as const).flatMap((severity) =>
    Array.from({ length: counts[severity] }, () => ({ severity })),
  );
}
