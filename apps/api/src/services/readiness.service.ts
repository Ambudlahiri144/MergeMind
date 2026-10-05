import { withTimeout } from '@mergemind/shared';

const READINESS_CHECK_TIMEOUT_MS = 2_000;

export type ReadinessCheck = {
  name: string;
  check: () => Promise<void>;
};

export type DependencyStatus = 'up' | 'down';

export type ReadinessReport = {
  isReady: boolean;
  checks: Record<string, DependencyStatus>;
};

/** Runs every dependency check in parallel, each bounded by a timeout. */
export async function checkReadiness(checks: readonly ReadinessCheck[]): Promise<ReadinessReport> {
  const results = await Promise.allSettled(
    checks.map(({ name, check }) => withTimeout(check(), READINESS_CHECK_TIMEOUT_MS, name)),
  );
  const statuses = Object.fromEntries(
    checks.map(({ name }, index) => [name, results[index]?.status === 'fulfilled' ? 'up' : 'down']),
  ) as Record<string, DependencyStatus>;

  return {
    isReady: Object.values(statuses).every((status) => status === 'up'),
    checks: statuses,
  };
}
