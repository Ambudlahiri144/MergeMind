import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

// Design.md §3 Button: a 2px ink border sitting on a hard shadow, pressed onto it on `:active`
// (`press`), 36px tall in the app and 40px for touch, labels of three words at most that never
// wrap. Classes adapted from neobrutalism.dev (THIRD_PARTY_NOTICES.md).
export const buttonVariants = cva(
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-base border-2 border-border px-3.5 text-sm font-bold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'press bg-main text-on-fill hover:bg-main-strong',
        secondary: 'press bg-surface text-text',
        ghost: 'border-transparent text-text hover:border-border hover:bg-surface-muted',
        danger: 'press bg-sev-critical-bg text-on-fill',
        // Ink with lemon text: the primary action on a lemon band, in both themes.
        ink: 'press bg-on-fill text-main',
      },
      size: {
        default: 'h-9',
        touch: 'h-10 min-w-10',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
