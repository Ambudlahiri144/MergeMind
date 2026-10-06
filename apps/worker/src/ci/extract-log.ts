import type { CiLogExcerpt } from '@mergemind/github';

import { redactLogLine } from './redact.js';

// CI log windowing (PRD F10, ADR-028). Pure: a raw job log in, a small cited excerpt out.
// GitHub's log format is not documented, so every marker is optional: without `##[group]` the
// whole log is one section, and without any error line the tail is shown.

export const EXCERPT_LIMITS = {
  maxLines: 150,
  maxChars: 8_000,
  maxLineChars: 300,
  beforeFirstAnchor: 30,
  afterLastAnchor: 10,
  /** Context kept around each anchor when the whole span is too long. */
  aroundAnchor: { before: 10, after: 3 },
  tailWhenNoAnchor: 80,
} as const;

export type LogLine = { number: number; text: string };

/** A UTF-8 BOM can lead the first line of a downloaded log. */
const BOM = String.fromCharCode(0xfeff);
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (0x1b).
const ANSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const SECTION_START = '##[group]Run ';
const ERROR_MARKER = '##[error]';
// `\w*error` also matches TypeError and AssertionError; "0 errors" does not match.
const FAILURE_SIGNAL =
  /\b\w*(?:error|exception)\b|\b(?:failed|failure|traceback|panic|fatal)\b|^\s*(?:FAIL|✖|×|●)\s/i;

/** Timestamps and ANSI colours stripped; numbers stay 1-based like GitHub's log viewer. */
export function normalizeLog(log: string): LogLine[] {
  const raw = log.split(/\r?\n/);
  if (raw.at(-1) === '') {
    raw.pop();
  }
  return raw.map((line, index) => ({
    number: index + 1,
    text: (line.startsWith(BOM) ? line.slice(1) : line)
      .replace(TIMESTAMP_PREFIX, '')
      .replace(ANSI_SEQUENCE, ''),
  }));
}

/** `[start, end)` indexes of the step section that holds the first `##[error]` line. */
function failingSection(lines: readonly LogLine[]): { start: number; end: number } {
  const errorIndex = lines.findIndex((line) => line.text.startsWith(ERROR_MARKER));
  if (errorIndex === -1) {
    return { start: 0, end: lines.length };
  }
  let start = 0;
  for (let index = errorIndex; index >= 0; index -= 1) {
    if (lines[index]?.text.startsWith(SECTION_START)) {
      start = index;
      break;
    }
  }
  // A failed step ends with `##[error]Process completed with exit code N.`; what follows
  // ("Post job cleanup.", git cleanup) is not always grouped, so stop at the step's last error.
  let end = errorIndex + 1;
  for (let index = errorIndex + 1; index < lines.length; index += 1) {
    const text = lines[index]?.text ?? '';
    if (text.startsWith(SECTION_START)) {
      break;
    }
    if (text.startsWith(ERROR_MARKER)) {
      end = index + 1;
    }
  }
  return { start, end };
}

function mergeRanges(ranges: readonly [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Indexes kept: the whole span when it fits, else windows around anchors (first, then last). */
function selectIndexes(anchors: readonly number[], start: number, end: number): number[] {
  const limits = EXCERPT_LIMITS;
  const first = anchors[0] ?? start;
  const last = anchors.at(-1) ?? first;
  const spanStart = Math.max(start, first - limits.beforeFirstAnchor);
  const spanEnd = Math.min(end - 1, last + limits.afterLastAnchor);
  if (spanEnd - spanStart + 1 <= limits.maxLines) {
    return range(spanStart, spanEnd);
  }
  const windows = mergeRanges(
    anchors.map((anchor) => [
      Math.max(start, anchor - limits.aroundAnchor.before),
      Math.min(end - 1, anchor + limits.aroundAnchor.after),
    ]),
  );
  // The first error is usually the cause and the last the summary; fill from both ends.
  const kept: [number, number][] = [];
  let budget = limits.maxLines;
  const order = windows.length > 1 ? [windows[0], ...windows.slice(1).reverse()] : windows;
  for (const window of order) {
    if (!window) {
      break;
    }
    const size = window[1] - window[0] + 1;
    const take = Math.min(size, budget);
    kept.push([window[1] - take + 1, window[1]]);
    budget -= take;
    if (budget === 0) {
      break;
    }
  }
  return mergeRanges(kept).flatMap(([from, to]) => range(from, to));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => from + offset);
}

function displayText(text: string): string {
  const clean = text.replace(/^##\[group\]/, '').replace(/^##\[error\]/, 'Error: ');
  const redacted = redactLogLine(clean);
  return redacted.length > EXCERPT_LIMITS.maxLineChars
    ? `${redacted.slice(0, EXCERPT_LIMITS.maxLineChars)}…`
    : redacted;
}

export type JobLogInput = {
  jobName: string;
  jobUrl: string | null;
  /** Name of the job's first failed step (from the jobs API), shown as the excerpt's step. */
  failedStep: string | null;
  log: string;
};

export type ExtractedLog = { excerpt: CiLogExcerpt; anchorCount: number };

/**
 * The window of a failed job's log worth showing: the failing step's section, centred on its
 * error lines, capped at 150 lines / 8 KB, credentials redacted.
 */
export function extractFailureWindow(input: JobLogInput): ExtractedLog {
  const lines = normalizeLog(input.log).filter((line) => line.text !== '##[endgroup]');
  const { start, end } = failingSection(lines);
  const anchors: number[] = [];
  for (let index = start; index < end; index += 1) {
    const text = lines[index]?.text ?? '';
    if (text.startsWith(ERROR_MARKER) || FAILURE_SIGNAL.test(text)) {
      anchors.push(index);
    }
  }
  const indexes =
    anchors.length > 0
      ? selectIndexes(anchors, start, end)
      : range(Math.max(start, end - EXCERPT_LIMITS.tailWhenNoAnchor), end - 1);

  const selected = indexes.flatMap((index) => {
    const line = lines[index];
    return line ? [{ number: line.number, text: displayText(line.text) }] : [];
  });
  // Character cap: drop from the start, keeping the error lines at the end.
  let chars = selected.reduce((total, line) => total + line.text.length + 1, 0);
  while (chars > EXCERPT_LIMITS.maxChars && selected.length > 1) {
    chars -= (selected.shift()?.text.length ?? 0) + 1;
  }

  return {
    excerpt: {
      jobName: input.jobName,
      jobUrl: input.jobUrl,
      stepName: input.failedStep,
      lines: selected,
    },
    anchorCount: anchors.length,
  };
}
