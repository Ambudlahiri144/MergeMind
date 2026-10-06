import type {
  FindingScope,
  FindingView,
  FindingsRepository,
  InstallationsRepository,
  PullRequestsRepository,
  RepositoriesRepository,
  RepositoryView,
  ReviewRunView,
  ReviewRunsRepository,
  SuppressionsRepository,
  UsageLedgerRepository,
} from '@mergemind/db';
import { NotFoundError, type InstallationRole } from '@mergemind/shared';

import type { AuthUser } from '../auth/api-token.js';
import type { AccessService, AccessibleInstallation } from './access.service.js';

/** The repositories the api reads and writes through (rules.md §4: DB only via these). */
export type ApiStores = {
  installations: InstallationsRepository;
  repositories: RepositoriesRepository;
  pullRequests: PullRequestsRepository;
  reviewRuns: ReviewRunsRepository;
  findings: FindingsRepository;
  suppressions: SuppressionsRepository;
  usageLedger: UsageLedgerRepository;
};

export type RepositoryScope = AccessibleInstallation & { repository: RepositoryView };

/**
 * Resolves a resource to its repository and installation and checks the caller's role:
 * a resource that does not exist is a 404, one in an installation they cannot see is a 403.
 */
export function createScopeService(stores: ApiStores, access: AccessService) {
  async function installation(user: AuthUser, installationId: string, minRole: InstallationRole) {
    if (!(await stores.installations.findById(installationId))) {
      throw new NotFoundError(`Installation ${installationId} not found`);
    }
    return access.requireRole(user, installationId, minRole);
  }

  async function repository(
    user: AuthUser,
    repositoryId: string,
    minRole: InstallationRole,
  ): Promise<RepositoryScope> {
    const found = await stores.repositories.findById(repositoryId);
    if (!found) {
      throw new NotFoundError(`Repository ${repositoryId} not found`);
    }
    return {
      ...(await access.requireRole(user, found.installationId, minRole)),
      repository: found,
    };
  }

  async function run(
    user: AuthUser,
    runId: string,
    minRole: InstallationRole,
  ): Promise<RepositoryScope & { run: ReviewRunView }> {
    const found = await stores.reviewRuns.findById(runId);
    if (!found) {
      throw new NotFoundError(`Review run ${runId} not found`);
    }
    return { ...(await repository(user, found.repositoryId, minRole)), run: found };
  }

  async function finding(
    user: AuthUser,
    findingId: string,
    minRole: InstallationRole,
  ): Promise<RepositoryScope & { finding: FindingView & FindingScope }> {
    const found = await stores.findings.findById(findingId);
    if (!found) {
      throw new NotFoundError(`Finding ${findingId} not found`);
    }
    return { ...(await repository(user, found.repositoryId, minRole)), finding: found };
  }

  return { installation, repository, run, finding };
}

export type ScopeService = ReturnType<typeof createScopeService>;
