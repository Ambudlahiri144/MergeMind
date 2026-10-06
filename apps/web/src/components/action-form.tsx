'use client';

import { useActionState, type ReactNode } from 'react';

import type { ActionResult } from '@/app/actions/mutations';
import { cn } from '@/lib/cn';

import { Button, type ButtonProps } from './ui/button';

type Action = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

const IDLE: ActionResult = { status: 'idle', message: '' };

/**
 * A form posting to a server action, with its result announced in a polite live region:
 * the "toast for transient action results" of Design.md §3, without a toast library.
 */
export function ActionForm({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'secondary',
  children,
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  variant?: ButtonProps['variant'];
  children?: ReactNode;
  className?: string;
}) {
  const [result, formAction, isPending] = useActionState(action, IDLE);
  return (
    <form action={formAction} className={cn('flex flex-col gap-2', className)}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div>
        <Button type="submit" variant={variant} disabled={isPending}>
          {isPending ? pendingLabel : label}
        </Button>
      </div>
      <p
        aria-live="polite"
        className={cn(
          'min-h-5 text-xs font-medium',
          result.status === 'error' ? 'text-sev-critical' : 'text-text-muted',
        )}
      >
        {result.message}
      </p>
    </form>
  );
}
