import type { Severity } from '../domain.js';
import { SEVERITY_RANK } from './findings.js';
import type { GateFailOn } from './policy.js';

/**
 * The `mergemind/review` conclusion for a completed review (PRD F4). `neutral` is decided by the
 * pipeline for runs that did not review (skipped, summary_only, every pass failed).
 */
export function evaluateGate(
  failOn: GateFailOn,
  postedFindings: readonly { severity: Severity }[],
): 'success' | 'failure' {
  if (failOn === 'never') {
    return 'success';
  }
  const threshold = SEVERITY_RANK[failOn];
  const isBlocked = postedFindings.some((finding) => SEVERITY_RANK[finding.severity] >= threshold);
  return isBlocked ? 'failure' : 'success';
}
