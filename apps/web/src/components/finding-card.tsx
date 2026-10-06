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
        'rounded-base border-2 border-border bg-surface p-4',
        // The selected finding sits on a lemon shadow instead of the ink one.
        isSelected ? 'shadow-hard-main' : 'shadow-hard',
      )}
    >
      <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-text-muted">
        <SeverityBadge severity={finding.severity} />
        <span>{finding.pass}</span>
        <Link
          href={href}
          scroll={false}
          aria-current={isSelected ? 'true' : undefined}
          className="font-mono text-[13px] text-text underline decoration-2 underline-offset-2 hover:bg-main hover:text-on-fill"
        >
          {finding.path}:{lines}
        </Link>
        {finding.state === 'open' ? null : <span>· {finding.state}</span>}
      </p>
      <h3 className="mt-3 text-[17px] leading-6 font-bold">{finding.title}</h3>
      <p className="mt-1 whitespace-pre-line text-text-muted">{finding.body}</p>
      {finding.suggestion ? (
        <pre
          tabIndex={0}
          className="mt-3 overflow-x-auto rounded-base border-2 border-border bg-surface-muted p-3 font-mono text-[13px] leading-5"
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
          className="inline-flex h-9 items-center gap-1 rounded-base border-2 border-transparent px-3 font-bold text-text underline decoration-2 underline-offset-2 hover:border-border hover:bg-surface-muted"
        >
          View on GitHub <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}
