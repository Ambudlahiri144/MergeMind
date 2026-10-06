'use client';

import { CheckIcon as Check, CopyIcon as Copy } from '@phosphor-icons/react';
import { useState } from 'react';

/** Mono text with a copy button (request ids, SHAs). */
export function CopyText({ value }: { value: string }) {
  const [isCopied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[13px] text-text">
        {value}
      </code>
      <button
        type="button"
        aria-label={isCopied ? 'Copied' : `Copy ${value}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-surface-muted"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
          });
        }}
      >
        {isCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      </button>
    </span>
  );
}
