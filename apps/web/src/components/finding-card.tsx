import type { FindingItem } from '@mergemind/shared';
import { ArrowSquareOutIcon as ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

import { cn } from '@/lib/cn';

import { DismissDialog } from './dismiss-dialog';
import { SeverityBadge } from './ui/severity';

/**
 * Design.md §3 finding card. Model text is shown as plain text (never rendered as HTML), so it
 * cannot inject markup; the suggestion is a code block.
 */
export function FindingCard({
  finding,
  href,
  isSelected,
}: {
  finding: FindingItem;
  href: string;
  isSelected: boolean;
}) {
  const lines =
    finding.lineStart === finding.lineEnd
      ? String(finding.lineStart)
      : `${String(finding.lineStart)}-${String(finding.lineEnd)}`;
  return (
    <article
      className={cn(
        'rounded-lg border bg-surface p-4',
        isSelected ? 'border-accent' : 'border-border',
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <SeverityBadge severity={finding.severity} />
        <span>{finding.pass}</span>
        <Link
          href={href}
          scroll={false}
          aria-current={isSelected ? 'true' : undefined}
          className="font-mono text-[13px] text-text hover:text-accent"
        >
          {finding.path}:{lines}
        </Link>
        {finding.state === 'open' ? null : <span>· {finding.state}</span>}
      </p>
      <h3 className="mt-2 text-[15px] leading-[22px] font-semibold">{finding.title}</h3>
      <p className="mt-1 whitespace-pre-line text-text-muted">{finding.body}</p>
      {finding.suggestion ? (
        <pre
          tabIndex={0}
          className="mt-3 overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-[13px] leading-5"
        >
          <code>{finding.suggestion}</code>
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {finding.state === 'open' ? (
          <DismissDialog findingId={finding.id} title={finding.title} />
        ) : null}
        <a
          href={finding.githubUrl}
          className="inline-flex h-9 items-center gap-1 rounded-md px-3 font-medium text-accent hover:bg-surface-muted"
        >
          View on GitHub <ArrowSquareOut size={16} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}
