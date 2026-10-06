import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Skeletons shaped like the final layout; no generic spinners (Design.md §3). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-base border-2 border-border/30 bg-surface-muted motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/** Icon tile + one sentence + one action, in one bordered panel. */
export function EmptyState({
  icon: IconComponent,
  message,
  action,
}: {
  icon: Icon;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-base border-2 border-border bg-surface px-6 py-12 text-center shadow-hard">
      <span className="grid size-14 place-items-center rounded-base border-2 border-border bg-main text-on-fill">
        <IconComponent size={28} weight="bold" aria-hidden="true" />
      </span>
      <p className="max-w-[48ch] text-text-muted">{message}</p>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 mb-8 border-b-2 border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
          {title}
        </h1>
        {meta ? <div className="mt-1 text-text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
