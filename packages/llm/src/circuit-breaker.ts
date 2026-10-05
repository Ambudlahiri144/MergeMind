/** Architecture.md §6: a provider opens after 3 consecutive failures, for 60 s. */
export const CIRCUIT_FAILURE_THRESHOLD = 3;
export const CIRCUIT_COOLDOWN_MS = 60_000;

export type Clock = { now(): number };

export const systemClock: Clock = { now: () => Date.now() };

type CircuitState = { consecutiveFailures: number; openedAt: number | null };

/**
 * In-process breaker per provider. Open: calls are skipped. After the cooldown it is half-open:
 * one call is let through; success closes it, failure re-opens it for another cooldown.
 */
export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly threshold = CIRCUIT_FAILURE_THRESHOLD,
    private readonly cooldownMs = CIRCUIT_COOLDOWN_MS,
  ) {}

  private stateOf(key: string): CircuitState {
    let state = this.states.get(key);
    if (!state) {
      state = { consecutiveFailures: 0, openedAt: null };
      this.states.set(key, state);
    }
    return state;
  }

  canCall(key: string): boolean {
    const { openedAt } = this.stateOf(key);
    return openedAt === null || this.clock.now() - openedAt >= this.cooldownMs;
  }

  recordSuccess(key: string): void {
    this.states.set(key, { consecutiveFailures: 0, openedAt: null });
  }

  recordFailure(key: string): void {
    const state = this.stateOf(key);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.threshold) {
      state.openedAt = this.clock.now();
    }
  }
}
