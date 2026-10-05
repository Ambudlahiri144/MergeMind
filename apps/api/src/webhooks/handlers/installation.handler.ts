import type { InstallationsRepository, RepositoriesRepository } from '@mergemind/db';
import {
  assertNever,
  type InstallationEvent,
  type InstallationRepositoriesEvent,
  type InstallationStatus,
} from '@mergemind/shared';

import type { HandlerResult } from './handler-result.js';

export type InstallationHandlerDeps = {
  installations: InstallationsRepository;
  repositories: RepositoriesRepository;
};

type GithubInstallation = InstallationEvent['installation'];
type GithubInstallationRepo = InstallationEvent['repositories'][number];

function toInstallationStatus(action: InstallationEvent['action']): InstallationStatus {
  switch (action) {
    case 'created':
    case 'unsuspend':
      return 'active';
    case 'suspend':
      return 'suspended';
    case 'deleted':
      return 'deleted';
    default:
      return assertNever(action, 'installation action');
  }
}

function toRepositoryInput(repo: GithubInstallationRepo) {
  return { githubRepoId: repo.id, fullName: repo.full_name, isPrivate: repo.private };
}

async function upsertInstallation(
  installation: GithubInstallation,
  status: InstallationStatus,
  deps: InstallationHandlerDeps,
): Promise<string> {
  return deps.installations.upsertFromGithub({
    githubInstallationId: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    status,
  });
}

/**
 * Inline sync (PRD F1): bounded, indexed writes, so it fits the 300 ms ack budget (ADR-016).
 * Upserting on every action also repairs state if an earlier `created` was missed.
 */
export async function handleInstallationEvent(
  event: InstallationEvent,
  deps: InstallationHandlerDeps,
): Promise<HandlerResult> {
  const status = toInstallationStatus(event.action);
  const installationId = await upsertInstallation(event.installation, status, deps);

  if (event.action === 'deleted') {
    await deps.repositories.markAllUninstalledForInstallation(installationId);
  } else {
    await deps.repositories.upsertManyForInstallation(
      installationId,
      event.repositories.map(toRepositoryInput),
    );
  }
  return { status: 'handled', reason: `installation_${event.action}` };
}

export async function handleInstallationRepositoriesEvent(
  event: InstallationRepositoriesEvent,
  deps: InstallationHandlerDeps,
): Promise<HandlerResult> {
  const installationId = await upsertInstallation(event.installation, 'active', deps);

  await deps.repositories.upsertManyForInstallation(
    installationId,
    event.repositories_added.map(toRepositoryInput),
  );
  await deps.repositories.markUninstalled(event.repositories_removed.map((repo) => repo.id));
  return { status: 'handled', reason: `repositories_${event.action}` };
}
