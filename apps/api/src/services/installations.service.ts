import { evaluateBudget, usagePeriod, type UsageResponse } from '@mergemind/shared';

import type { AuthUser } from '../auth/api-token.js';
import type { ApiStores, ScopeService } from './scope.service.js';

export function createInstallationsService(deps: {
  stores: ApiStores;
  scope: ScopeService;
  now: () => Date;
}) {
  const { stores, scope } = deps;

  return {
    /** `GET /installations/:id/usage`: month-to-date tokens against the budget (PRD F9). */
    async usage(user: AuthUser, installationId: string): Promise<UsageResponse> {
      const { installation } = await scope.installation(user, installationId, 'member');
      const period = usagePeriod(deps.now());
      const byKind = await stores.usageLedger.sumTokensByKindForPeriod(installation.id, period);
      const usedTokens = byKind.review + byKind.embed + byKind.ci_summary;
      return {
        period,
        usedTokens,
        monthlyTokenBudget: installation.monthlyTokenBudget,
        state: evaluateBudget(usedTokens, installation.monthlyTokenBudget),
        byKind,
      };
    },
  };
}

export type InstallationsService = ReturnType<typeof createInstallationsService>;
