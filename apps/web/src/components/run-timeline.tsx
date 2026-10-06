import type { RunSummary } from '@mergemind/shared';
import Link from 'next/link';

import { duration, modeLabel, shortSha, timeAgo, triggerLabel } from '@/lib/format';

/** Severity counts as text, never colour alone: "1 critical, 2 major". */
export function CountsText({ counts }: { counts: RunSummary['counts'] }) {
  const parts = (['critical', 'major', 'minor'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${String(counts[severity])} ${severity}`);
  return <span>{parts.length > 0 ? parts.join(', ') : 'No open findings'}</span>;
}

function statusText(run: RunSummary): string {
  if (run.status === 'failed') {
    return 'Failed';
  }
  if (run.status !== 'completed') {
    return 'Running';
  }
  if (run.gateConclusion === 'failure') {
    return 'Blocked';
  }
  return run.gateConclusion === 'success' ? 'Passed' : 'No verdict';
}

/** Design.md §3 run timeline: newest first; SHA, trigger, mode, status, duration, counts. */
export function RunTimeline({ runs }: { runs: readonly RunSummary[] }) {
  return (
    <ol className="divide-y-2 divide-border overflow-hidden rounded-base border-2 border-border bg-surface shadow-hard">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            href={`/runs/${run.id}`}
            className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4 py-3 hover:bg-surface-muted md:grid-cols-[7rem_minmax(0,1fr)_8rem_6rem] md:items-center md:gap-4"
          >
            <span className="font-mono text-[13px]">
              {shortSha(run.headSha)}
              {run.attempt > 1 ? <span className="text-text-muted"> #{run.attempt}</span> : null}
            </span>
            <span className="min-w-0 truncate">
              {triggerLabel(run.trigger)} · {modeLabel(run.mode)} ·{' '}
              <CountsText counts={run.counts} />
            </span>
            <span className="font-bold">{statusText(run)}</span>
            <span className="text-xs text-text-muted md:text-right">
              <time dateTime={run.createdAt}>{timeAgo(run.createdAt)}</time>
              {run.durationMs > 0 ? ` · ${duration(run.durationMs)}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
