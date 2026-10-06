import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Skeletons shaped like the final layout; no generic spinners (Design.md §3). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/** Icon + one sentence + one action. */
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
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
      <IconComponent size={32} className="text-text-muted" aria-hidden="true" />
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
    <header className="flex flex-col gap-3 pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl leading-8 font-semibold tracking-[-0.01em]">{title}</h1>
        {meta ? <div className="mt-1 text-text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
