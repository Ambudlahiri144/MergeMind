import type {
  InstallationView,
  InstallationsRepository,
  UserAccess,
  UsersRepository,
} from '@mergemind/db';
import type { GithubApp } from '@mergemind/github';
import { ForbiddenError, type InstallationRole } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';

import type { AuthUser } from '../auth/api-token.js';

/** Re-resolved from GitHub at most this often per user (ADR-030). */
export const ACCESS_TTL_MS = 10 * 60 * 1000;
/** Installations checked per resolution; beyond this a user-token flow would be needed. */
export const MAX_INSTALLATIONS_CHECKED = 200;
const MEMBERSHIP_CONCURRENCY = 4;

const ROLE_RANK: Record<InstallationRole, number> = { member: 1, admin: 2, owner: 3 };

export type AccessDeps = {
  installations: InstallationsRepository;
  users: UsersRepository;
  /** Null when the GitHub App is not configured: only user-account installations resolve. */
  github: GithubApp | null;
  logger: Logger;
  now: () => Date;
};

export type AccessibleInstallation = { installation: InstallationView; role: InstallationRole };

export type AccessService = {
  /** Every active installation the user may see, with their role. */
  listAccessible(user: AuthUser): Promise<AccessibleInstallation[]>;
  /** The user's role, or ForbiddenError when it is missing or below `minRole`. */
  requireRole(
    user: AuthUser,
    installationId: string,
    minRole: InstallationRole,
  ): Promise<AccessibleInstallation>;
};

/**
 * Pure part of the role decision (ADR-030): a user-account installation belongs to its owner;
 * an org installation follows the user's org membership (admin or member, active only).
 */
export function decideRole(
  installation: Pick<InstallationView, 'accountType' | 'accountLogin'>,
  login: string,
  membership: { role: 'admin' | 'member'; state: 'active' | 'pending' } | null,
): InstallationRole | null {
  if (installation.accountType === 'User') {
    return installation.accountLogin.toLowerCase() === login.toLowerCase() ? 'owner' : null;
  }
  if (membership?.state !== 'active') {
    return null;
  }
  return membership.role;
}

export function hasRole(role: InstallationRole, minRole: InstallationRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    results.push(...(await Promise.all(items.slice(index, index + limit).map(fn))));
  }
  return results;
}

/**
 * The api decides who may see what; the web only proves identity (ADR-030). Roles come from
 * GitHub (installation owner, or org membership via the installation token) and are cached on
 * the user for ACCESS_TTL_MS, so a page load costs no GitHub calls after the first.
 */
export function createAccessService(deps: AccessDeps): AccessService {
  async function resolve(user: AuthUser, installations: readonly InstallationView[]) {
    let hadError = false;
    const resolved = await mapLimited(
      installations,
      MEMBERSHIP_CONCURRENCY,
      async (installation): Promise<UserAccess | null> => {
        let membership = null;
        if (installation.accountType === 'Organization') {
          if (deps.github === null) {
            return null;
          }
          try {
            const client = await deps.github.forInstallation(installation.githubInstallationId);
            membership = await client.getOrgMembership({
              org: installation.accountLogin,
              username: user.login,
            });
          } catch (error) {
            hadError = true;
            deps.logger.warn(
              { err: error, installationId: installation.id },
              'access.membershipUnavailable',
            );
            return null;
          }
        }
        const role = decideRole(installation, user.login, membership);
        return role === null ? null : { installationId: installation.id, role };
      },
    );
    return {
      access: resolved.filter((entry): entry is UserAccess => entry !== null),
      hadError,
    };
  }

  async function listAccessible(user: AuthUser): Promise<AccessibleInstallation[]> {
    const installations = await deps.installations.listActive(MAX_INSTALLATIONS_CHECKED);
    const byId = new Map(installations.map((installation) => [installation.id, installation]));
    const cached = await deps.users.findByGithubUserId(user.githubUserId);
    const now = deps.now();
    const checked = new Set(cached?.checkedInstallationIds ?? []);
    // Stale after the TTL, after a login rename, or as soon as an installation appears that
    // the cache never looked at (a fresh install must not wait ten minutes to show up).
    const isFresh =
      cached?.accessCheckedAt != null &&
      cached.login === user.login &&
      now.getTime() - cached.accessCheckedAt.getTime() < ACCESS_TTL_MS &&
      installations.every((installation) => checked.has(installation.id));

    let access = cached?.access ?? [];
    if (!isFresh) {
      const result = await resolve(user, installations);
      access = result.access;
      // A GitHub hiccup must not hide installations for ten minutes: only cache clean results.
      if (!result.hadError) {
        await deps.users.saveAccess({
          githubUserId: user.githubUserId,
          login: user.login,
          access,
          checkedInstallationIds: installations.map((installation) => installation.id),
          checkedAt: now,
        });
      }
    }
    return access.flatMap(({ installationId, role }) => {
      const installation = byId.get(installationId);
      return installation ? [{ installation, role }] : [];
    });
  }

  return {
    listAccessible,
    async requireRole(user, installationId, minRole) {
      const match = (await listAccessible(user)).find(
        (entry) => entry.installation.id === installationId,
      );
      if (!match) {
        throw new ForbiddenError('You do not have access to this installation');
      }
      if (!hasRole(match.role, minRole)) {
        throw new ForbiddenError(`This action needs the ${minRole} role on the installation`);
      }
      return match;
    },
  };
}
