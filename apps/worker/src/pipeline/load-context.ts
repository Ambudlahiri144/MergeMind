import type { InstallationView, PullRequestView, RepositoryView } from '@mergemind/db';
import { parseRepoFullName, type GithubInstallationClient, type RepoRef } from '@mergemind/github';
import {
  POLICY_FILE_PATH,
  parsePolicy,
  type PolicyResult,
  type ReviewPrJobData,
  type SkipReason,
} from '@mergemind/shared';

import { escalateVisibility } from '../repository-visibility.js';
import type { ReviewDeps } from './types.js';

export type BaseContext = {
  data: ReviewPrJobData;
  repoRef: RepoRef;
  installation: InstallationView;
  repository: RepositoryView;
  pullRequest: PullRequestView;
  /** A newer head SHA is already stored for this PR, so this job's SHA is stale. */
  isSuperseded: boolean;
};

async function ensureInstallation(
  githubInstallationId: number,
  deps: ReviewDeps,
): Promise<InstallationView> {
  const known = await deps.installations.findByGithubId(githubInstallationId);
  if (known) {
    return known;
  }
  // Installed before MergeMind was running (missed `installation.created`): ask GitHub.
  const account = await deps.github.getInstallationAccount(githubInstallationId);
  await deps.installations.upsertFromGithub({
    githubInstallationId,
    accountLogin: account.login,
    accountType: account.type,
    status: 'active',
  });
  const created = await deps.installations.findByGithubId(githubInstallationId);
  if (!created) {
    throw new Error(`Installation ${githubInstallationId} vanished after upsert`);
  }
  return created;
}

async function ensureRepository(
  data: ReviewPrJobData,
  installationId: string,
  deps: ReviewDeps,
): Promise<RepositoryView> {
  const known = await deps.repositories.findByGithubRepoId(data.githubRepoId);
  // Never re-create a repo that was uninstalled: that would undo the uninstall (PRD F1).
  if (known) {
    return escalateVisibility(known, data.isPrivate, deps.repositories);
  }
  await deps.repositories.upsertForInstallation(installationId, {
    githubRepoId: data.githubRepoId,
    fullName: data.repoFullName,
    isPrivate: data.isPrivate,
    defaultBranch: data.defaultBranch,
  });
  const created = await deps.repositories.findByGithubRepoId(data.githubRepoId);
  if (!created) {
    throw new Error(`Repository ${data.githubRepoId} vanished after upsert`);
  }
  return created;
}

/** Stage 1a: DB state for the job, without calling the installation's GitHub API yet. */
export async function loadBaseContext(
  data: ReviewPrJobData,
  deps: ReviewDeps,
): Promise<BaseContext> {
  const installation = await ensureInstallation(data.githubInstallationId, deps);
  const repository = await ensureRepository(data, installation.id, deps);
  await deps.pullRequests.upsertIfNewer({
    repositoryId: repository.id,
    number: data.prNumber,
    title: data.title,
    authorLogin: data.authorLogin,
    baseRef: data.baseRef,
    headRef: data.headRef,
    headSha: data.headSha,
    state: 'open',
    isDraft: data.isDraft,
    githubUpdatedAt: new Date(data.githubUpdatedAt),
  });
  const pullRequest = await deps.pullRequests.findByNumber(repository.id, data.prNumber);
  if (!pullRequest) {
    throw new Error(`Pull request ${data.repoFullName}#${data.prNumber} vanished after upsert`);
  }
  return {
    data,
    repoRef: parseRepoFullName(data.repoFullName),
    installation,
    repository,
    pullRequest,
    isSuperseded: pullRequest.headSha !== data.headSha,
  };
}

/**
 * Stage 1b: `.mergemind.yml` on the PR's **base branch** (PRD F7, ADR-033), so a PR cannot
 * relax its own review (e.g. `gate.failOn: never`). Missing or invalid → defaults + errors.
 */
export async function loadPolicy(
  client: GithubInstallationClient,
  context: BaseContext,
): Promise<PolicyResult> {
  const text = await client.getFileText({
    ...context.repoRef,
    path: POLICY_FILE_PATH,
    ref: context.data.baseRef,
  });
  return parsePolicy(text);
}

/** Stage 2 (pure): reasons to stop before creating a check run, in priority order. */
export function decideSkip(context: BaseContext, policy?: PolicyResult): SkipReason | null {
  if (!context.repository.isInstalled) {
    return 'not_installed';
  }
  if (!context.repository.isEnabled) {
    return 'disabled';
  }
  if (context.installation.status !== 'active') {
    return 'installation_inactive';
  }
  if (context.isSuperseded) {
    return 'superseded';
  }
  if (policy === undefined) {
    return null;
  }
  if (!policy.policy.review.enabled) {
    return 'policy_disabled';
  }
  if (policy.policy.review.skipDrafts && context.data.isDraft) {
    return 'draft';
  }
  return null;
}
