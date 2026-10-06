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
  critical: {
    label: 'Critical',
    className: 'bg-sev-critical-bg text-sev-critical',
    Icon: WarningOctagon,
  },
  major: { label: 'Major', className: 'bg-sev-major-bg text-sev-major', Icon: Warning },
  minor: { label: 'Minor', className: 'bg-sev-minor-bg text-sev-minor', Icon: Info },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, className, Icon } = SEVERITY_STYLE[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tracking-[0.04em] uppercase',
        className,
      )}
    >
      <Icon size={14} weight="bold" aria-hidden="true" />
      {label}
    </span>
  );
}

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
      <p className="inline-flex items-center gap-2 font-medium text-sev-critical">
        <WarningOctagon size={20} weight="bold" aria-hidden="true" />
        Merge blocked: {blocking} {level} finding{blocking === 1 ? '' : 's'}
      </p>
    );
  }
  if (conclusion === 'success') {
    return (
      <p className="inline-flex items-center gap-2 font-medium text-pass">
        <CheckCircle size={20} weight="bold" aria-hidden="true" />
        Passed
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-2 font-medium text-text-muted">
      <Info size={20} aria-hidden="true" />
      {conclusion === 'neutral' ? 'No verdict' : 'In progress'}
    </p>
  );
}
