import type { GateConclusion, Severity } from '@mergemind/shared';
import {
  CheckCircleIcon as CheckCircle,
  InfoIcon as Info,
  WarningIcon as Warning,
  WarningOctagonIcon as WarningOctagon,
} from '@phosphor-icons/react/dist/ssr';

import { cn } from '@/lib/cn';

// Severity is semantic state, never decoration, and never colour alone (Design.md §2.2, §7).

const SEVERITY_STYLE: Record<Severity, { label: string; className: string; Icon: typeof Info }> = {
  critical: { label: 'Critical', className: 'bg-sev-critical-bg', Icon: WarningOctagon },
  major: { label: 'Major', className: 'bg-sev-major-bg', Icon: Warning },
  minor: { label: 'Minor', className: 'bg-sev-minor-bg', Icon: Info },
};

/** A flat severity sticker: fill, ink border, icon and label (never colour alone). */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, className, Icon } = SEVERITY_STYLE[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border-2 border-border px-2 py-0.5 font-mono text-xs font-medium tracking-[0.04em] text-on-fill uppercase',
        className,
      )}
    >
      <Icon size={14} weight="bold" aria-hidden="true" />
      {label}
    </span>
  );
}

const GATE_BANNER =
  'inline-flex items-center gap-2 rounded-base border-2 border-border px-3 py-1.5 font-bold shadow-hard-sm';

/** "Merge blocked: 1 critical finding" or "Passed" (Design.md §3 Gate result). */
export function GateResult({
  conclusion,
  counts,
}: {
  conclusion: GateConclusion | null;
  counts: { critical: number; major: number; minor: number };
}) {
  if (conclusion === 'failure') {
    const blocking = counts.critical > 0 ? counts.critical : counts.major;
    const level = counts.critical > 0 ? 'critical' : 'major';
    return (
      <p className={cn(GATE_BANNER, 'bg-sev-critical-bg text-on-fill')}>
        <WarningOctagon size={20} weight="bold" aria-hidden="true" />
        Merge blocked: {blocking} {level} finding{blocking === 1 ? '' : 's'}
      </p>
    );
  }
  if (conclusion === 'success') {
    return (
      <p className={cn(GATE_BANNER, 'bg-pass-bg text-on-fill')}>
        <CheckCircle size={20} weight="bold" aria-hidden="true" />
        Passed
      </p>
    );
  }
  return (
    <p className={cn(GATE_BANNER, 'bg-surface text-text-muted shadow-none')}>
      <Info size={20} weight="bold" aria-hidden="true" />
      {conclusion === 'neutral' ? 'No verdict' : 'In progress'}
    </p>
  );
}
