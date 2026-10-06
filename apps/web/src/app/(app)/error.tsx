'use client';

import { WarningCircleIcon as WarningCircle } from '@phosphor-icons/react';

import { CopyText } from '@/components/copy-text';
import { Button } from '@/components/ui/button';

/** Unexpected errors only; API problems are shown inline by each page with their details. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-base border-2 border-border bg-surface shadow-hard p-4 md:flex-row md:items-start"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-base border-2 border-border bg-sev-critical-bg text-on-fill">
        <WarningCircle size={20} weight="bold" aria-hidden="true" />
      </span>
      <div className="flex-1">
        <p className="font-bold">Something went wrong</p>
        <p className="mt-1 text-text-muted">
          This page could not load. Try again, and if it keeps failing, share the reference below.
        </p>
        {error.digest ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            Reference <CopyText value={error.digest} />
          </p>
        ) : null}
      </div>
      <Button onClick={retry}>Retry</Button>
    </div>
  );
}
