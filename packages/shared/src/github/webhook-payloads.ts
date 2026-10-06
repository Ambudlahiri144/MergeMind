import { z } from 'zod';

import { ACCOUNT_TYPES } from '../domain.js';

// Subsets of GitHub webhook payloads: only the fields MergeMind reads.
// Zod objects strip unknown keys, so new GitHub fields never break parsing.

const GithubIdSchema = z.number().int().positive();

export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'must be a 40-char git SHA');

/** Any payload: `action` is read first to route the event. */
export const WebhookActionSchema = z.object({ action: z.string().optional() });

const AccountSchema = z.object({
  id: GithubIdSchema,
  login: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
});

const InstallationRefSchema = z.object({ id: GithubIdSchema });

const InstallationSchema = InstallationRefSchema.extend({ account: AccountSchema });

/** Repository entries in installation payloads (no default branch there). */
const InstallationRepositorySchema = z.object({
  id: GithubIdSchema,
  full_name: z.string().min(1),
  private: z.boolean(),
});

export const INSTALLATION_ACTIONS = ['created', 'deleted', 'suspend', 'unsuspend'] as const;

export const InstallationEventSchema = z.object({
  action: z.enum(INSTALLATION_ACTIONS),
  installation: InstallationSchema,
  repositories: z.array(InstallationRepositorySchema).default([]),
});
export type InstallationEvent = z.infer<typeof InstallationEventSchema>;

export const INSTALLATION_REPOSITORIES_ACTIONS = ['added', 'removed'] as const;

export const InstallationRepositoriesEventSchema = z.object({
  action: z.enum(INSTALLATION_REPOSITORIES_ACTIONS),
  installation: InstallationSchema,
  repositories_added: z.array(InstallationRepositorySchema),
  repositories_removed: z.array(InstallationRepositorySchema.pick({ id: true, full_name: true })),
});
export type InstallationRepositoriesEvent = z.infer<typeof InstallationRepositoriesEventSchema>;

const GitRefSchema = z.object({
  ref: z.string().min(1),
  sha: GitShaSchema,
});

export const PullRequestEventSchema = z.object({
  action: z.string(),
  number: GithubIdSchema,
  installation: InstallationRefSchema,
  repository: z.object({
    id: GithubIdSchema,
    full_name: z.string().min(1),
    private: z.boolean(),
    default_branch: z.string().min(1),
  }),
  pull_request: z.object({
    number: GithubIdSchema,
    title: z.string(),
    state: z.enum(['open', 'closed']),
    draft: z.boolean(),
    merged: z.boolean().nullish(),
    updated_at: z.iso.datetime({ offset: true }),
    user: z.object({ login: z.string().min(1) }),
    head: GitRefSchema,
    base: GitRefSchema,
  }),
});
export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;

/** A push; only pushes to the default branch matter (they refresh the code index, PRD F6). */
export const PushEventSchema = z.object({
  ref: z.string().min(1),
  after: GitShaSchema,
  deleted: z.boolean().default(false),
  installation: InstallationRefSchema,
  repository: z.object({
    id: GithubIdSchema,
    full_name: z.string().min(1),
    private: z.boolean(),
    default_branch: z.string().min(1),
  }),
});
export type PushEvent = z.infer<typeof PushEventSchema>;

export const REPOSITORY_ACTIONS = ['publicized', 'privatized', 'renamed'] as const;

/** Visibility and name changes; the payload's `repository` holds the new state (ADR-027). */
export const RepositoryEventSchema = z.object({
  action: z.enum(REPOSITORY_ACTIONS),
  installation: InstallationRefSchema,
  repository: InstallationRepositorySchema,
});
export type RepositoryEvent = z.infer<typeof RepositoryEventSchema>;

/** A finished GitHub Actions run (PRD F10). `pull_requests` is empty for fork PRs. */
export const WorkflowRunEventSchema = z.object({
  action: z.string(),
  installation: InstallationRefSchema,
  repository: InstallationRepositorySchema,
  workflow_run: z.object({
    id: GithubIdSchema,
    name: z.string().nullish(),
    workflow_id: GithubIdSchema,
    run_number: z.number().int().positive(),
    run_attempt: z.number().int().positive(),
    head_sha: GitShaSchema,
    head_branch: z.string().nullish(),
    status: z.string(),
    conclusion: z.string().nullish(),
    html_url: z.url(),
    head_repository: z.object({ id: GithubIdSchema }).nullish(),
    pull_requests: z
      .array(z.object({ number: GithubIdSchema, head: z.object({ sha: GitShaSchema }) }))
      .nullish(),
  }),
});
export type WorkflowRunEvent = z.infer<typeof WorkflowRunEventSchema>;
