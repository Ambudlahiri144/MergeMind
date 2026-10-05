/** Share of the monthly budget at which the summary starts warning (PRD F9). */
export const BUDGET_WARN_RATIO = 0.8;

export type BudgetState = 'ok' | 'warn' | 'exhausted';

export function evaluateBudget(usedTokens: number, monthlyTokenBudget: number): BudgetState {
  if (monthlyTokenBudget <= 0 || usedTokens >= monthlyTokenBudget) {
    return 'exhausted';
  }
  return usedTokens >= monthlyTokenBudget * BUDGET_WARN_RATIO ? 'warn' : 'ok';
}

/** `usageLedger.period` key: calendar month in UTC, `YYYY-MM`. */
export function usagePeriod(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}
