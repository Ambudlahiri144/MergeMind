import type { Severity, SnippetResponse } from '@mergemind/shared';

import { cn } from '@/lib/cn';
import { shortSha } from '@/lib/format';

const FLAG_GUTTER: Record<Severity, string> = {
  critical: 'bg-sev-critical-bg',
  major: 'bg-sev-major-bg',
  minor: 'bg-sev-minor-bg',
};

/**
 * Design.md §3 diff snippet: a code "window" with an ink title bar (path and SHA), JetBrains
 * Mono 13px, and flagged lines marked by a severity-filled line-number gutter. Scrolls inside
 * the block only.
 */
export function DiffSnippet({
  snippet,
  severity,
}: {
  snippet: SnippetResponse;
  severity: Severity;
}) {
  return (
    <figure className="overflow-hidden rounded-base border-2 border-border shadow-hard">
      <figcaption className="flex items-center justify-between gap-3 border-b-2 border-border bg-border px-3 py-2 text-xs text-bg">
        <span className="truncate font-mono font-medium">{snippet.path}</span>
        <span className="shrink-0 font-mono">{shortSha(snippet.ref)}</span>
      </figcaption>
      <pre
        tabIndex={0}
        className="overflow-x-auto bg-surface-muted py-2 font-mono text-[13px] leading-5"
      >
        <code className="block min-w-max">
          {snippet.lines.map((line) => {
            const isFlagged =
              line.number >= snippet.highlight.start && line.number <= snippet.highlight.end;
            return (
              <span
                key={line.number}
                className={cn('flex pr-4', isFlagged ? 'bg-surface font-medium' : null)}
              >
                <span
                  className={cn(
                    'mr-3 w-12 shrink-0 border-r-2 border-border pr-3 text-right select-none',
                    isFlagged ? cn(FLAG_GUTTER[severity], 'text-on-fill') : 'text-text-muted',
                  )}
                >
                  {line.number}
                </span>
                <span className="whitespace-pre">{line.text === '' ? ' ' : line.text}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
