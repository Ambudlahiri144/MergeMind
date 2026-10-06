// Display helpers. Copy rules (Design.md §6): no em or en dashes, sentence case, real numbers.

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago", "yesterday"; "just now" under a minute. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return RELATIVE.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

export function duration(ms: number): string {
  if (ms < 1000) {
    return `${String(ms)} ms`;
  }
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${String(seconds)} s`
    : `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
}

/** 1240000 -> "1.24M", 2000000 -> "2M", 950 -> "950". */
export function compactTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${String(Number((value / 1_000_000).toFixed(2)))}M`;
  }
  if (value >= 1_000) {
    return `${String(Number((value / 1_000).toFixed(1)))}K`;
  }
  return String(value);
}

const MODE_LABEL: Record<string, string> = {
  full: 'Full review',
  incremental: 'Incremental',
  summary_only: 'Summary only',
  skipped: 'Skipped',
};

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode;
}

const TRIGGER_LABEL: Record<string, string> = {
  opened: 'Opened',
  synchronize: 'Push',
  reopened: 'Reopened',
  ready_for_review: 'Ready for review',
  manual: 'Manual rerun',
};

export function triggerLabel(trigger: string): string {
  return TRIGGER_LABEL[trigger] ?? trigger;
}
