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
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-start"
    >
      <WarningCircle size={20} className="mt-0.5 shrink-0 text-sev-critical" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">Something went wrong</p>
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
