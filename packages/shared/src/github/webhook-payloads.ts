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
