'use client';

import { MAX_DISMISS_REASON_LENGTH } from '@mergemind/shared';
import { useActionState, useEffect, useId, useRef } from 'react';

import { dismissFinding, type ActionResult } from '@/app/actions/mutations';
import { Z_INDEX } from '@/lib/z-index';

import { Button } from './ui/button';

const IDLE: ActionResult = { status: 'idle', message: '' };

/** "Dismiss" opens a native <dialog> (focus trap and Escape for free) asking for a reason. */
export function DismissDialog({ findingId, title }: { findingId: string; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonId = useId();
  const [result, formAction, isPending] = useActionState(dismissFinding, IDLE);

  useEffect(() => {
    if (result.status === 'ok') {
      dialog.current?.close();
    }
  }, [result]);

  return (
    <>
      <Button variant="ghost" onClick={() => dialog.current?.showModal()}>
        Dismiss
      </Button>
      <p aria-live="polite" className="sr-only">
        {result.status === 'ok' ? result.message : ''}
      </p>
      <dialog
        ref={dialog}
        aria-labelledby={`${reasonId}-title`}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-text shadow-pop backdrop:bg-[rgb(15_17_21/0.4)]"
        style={{ zIndex: Z_INDEX.dialog }}
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <input type="hidden" name="findingId" value={findingId} />
          <h2 id={`${reasonId}-title`} className="text-[15px] leading-[22px] font-semibold">
            Dismiss this finding?
          </h2>
          <p className="text-text-muted">
            {title}. MergeMind will stop reporting it in this repository.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId} className="font-medium">
              Reason
            </label>
            <span id={`${reasonId}-help`} className="text-xs text-text-muted">
              Optional. Helps teammates understand why it was dismissed.
            </span>
            <textarea
              id={reasonId}
              name="reason"
              rows={3}
              maxLength={MAX_DISMISS_REASON_LENGTH}
              aria-describedby={`${reasonId}-help`}
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
            {result.status === 'error' ? (
              <p role="alert" className="text-xs text-sev-critical">
                {result.message}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={isPending}>
              {isPending ? 'Dismissing' : 'Dismiss'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
