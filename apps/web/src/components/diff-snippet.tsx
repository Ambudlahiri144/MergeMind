import type { Severity, SnippetResponse } from '@mergemind/shared';

import { cn } from '@/lib/cn';
import { shortSha } from '@/lib/format';

const FLAG_BORDER: Record<Severity, string> = {
  critical: 'border-l-sev-critical',
  major: 'border-l-sev-major',
  minor: 'border-l-sev-minor',
};

/**
 * Design.md §3 diff snippet: Geist Mono 13px on surface-muted, muted line numbers, flagged lines
 * marked with a 2px left border in the severity colour. Scrolls inside the block only.
 */
export function DiffSnippet({
  snippet,
  severity,
}: {
  snippet: SnippetResponse;
  severity: Severity;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 text-xs">
        <span className="truncate font-mono">{snippet.path}</span>
        <span className="shrink-0 font-mono text-text-muted">{shortSha(snippet.ref)}</span>
      </figcaption>
      <pre className="overflow-x-auto bg-surface-muted py-2 font-mono text-[13px] leading-5">
        <code className="block min-w-max">
          {snippet.lines.map((line) => {
            const isFlagged =
              line.number >= snippet.highlight.start && line.number <= snippet.highlight.end;
            return (
              <span
                key={line.number}
                className={cn(
                  'flex border-l-2 pr-4',
                  isFlagged ? cn(FLAG_BORDER[severity], 'bg-surface') : 'border-l-transparent',
                )}
              >
                <span className="w-12 shrink-0 pr-3 text-right text-text-muted select-none">
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
