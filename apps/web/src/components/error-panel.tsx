import { WarningCircleIcon as WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';

import type { Problem } from '@/lib/api';

import { CopyText } from './copy-text';

/** Design.md §3 error state: problem title, detail and a copyable request id, plus a retry. */
export function ErrorPanel({ problem, action }: { problem: Problem; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-base border-2 border-border bg-surface p-4 shadow-hard md:flex-row md:items-start"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-base border-2 border-border bg-sev-critical-bg text-on-fill">
        <WarningCircle size={20} weight="bold" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{problem.title}</p>
        <p className="mt-1 text-text-muted">{problem.detail}</p>
        {problem.requestId ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            Request id <CopyText value={problem.requestId} />
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
