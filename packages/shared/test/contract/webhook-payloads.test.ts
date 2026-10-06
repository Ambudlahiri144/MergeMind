import { describe, expect, it } from 'vitest';

import {
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  PullRequestEventSchema,
  PushEventSchema,
  RepositoryEventSchema,
  WebhookActionSchema,
  WorkflowRunEventSchema,
} from '../../src/index.js';
import { loadGithubFixture } from '../../src/testing/index.js';

describe('GitHub webhook payload contracts', () => {
  it.each(['installation.created', 'installation.deleted', 'installation.suspend'])(
    '%s parses with InstallationEventSchema',
    async (name) => {
      const { payload } = await loadGithubFixture(name);

      const result = InstallationEventSchema.safeParse(payload);

      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );

  it.each(['installation_repositories.added', 'installation_repositories.removed'])(
    '%s parses with InstallationRepositoriesEventSchema',
    async (name) => {
      const { payload } = await loadGithubFixture(name);

      const result = InstallationRepositoriesEventSchema.safeParse(payload);

      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );

  it.each([
    'pull_request.opened',
    'pull_request.synchronize',
    'pull_request.ready_for_review',
    'pull_request.closed',
  ])('%s parses with PullRequestEventSchema', async (name) => {
    const { payload } = await loadGithubFixture(name);

    const result = PullRequestEventSchema.safeParse(payload);

    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('strips fields MergeMind does not read', async () => {
    const { payload } = await loadGithubFixture('pull_request.opened');

    const parsed = PullRequestEventSchema.parse(payload);

    expect(parsed).not.toHaveProperty('sender');
    expect(parsed.pull_request).not.toHaveProperty('body');
  });

  it('reads the action of a payload without one (push)', async () => {
    const { payload } = await loadGithubFixture('push.default-branch');

    expect(WebhookActionSchema.parse(payload)).toEqual({});
  });

  it('rejects a pull_request payload with a malformed head SHA', async () => {
    const { payload } = await loadGithubFixture('pull_request.opened');
    const pullRequest = payload.pull_request as { head: { sha: string } };
    pullRequest.head.sha = 'not-a-sha';

    expect(PullRequestEventSchema.safeParse(payload).success).toBe(false);
  });
});

describe('push payload contract', () => {
  it('push.default-branch parses with PushEventSchema (deleted defaults to false)', async () => {
    const { payload } = await loadGithubFixture('push.default-branch');

    const parsed = PushEventSchema.parse(payload);

    expect(parsed).toMatchObject({
      ref: 'refs/heads/main',
      deleted: false,
      repository: { default_branch: 'main' },
    });
  });
});

describe('repository payload contract', () => {
  it.each(['repository.publicized', 'repository.privatized', 'repository.renamed'])(
    '%s parses with RepositoryEventSchema',
    async (name) => {
      const { payload } = await loadGithubFixture(name);

      const result = RepositoryEventSchema.safeParse(payload);

      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );

  it('carries the new name and visibility after a rename', async () => {
    const { payload } = await loadGithubFixture('repository.renamed');

    expect(RepositoryEventSchema.parse(payload).repository).toEqual({
      id: 77700001,
      full_name: 'octo-demo/billing-api',
      private: true,
    });
  });
});

describe('workflow_run payload contract', () => {
  it.each([
    'workflow_run.completed-failure',
    'workflow_run.completed-success',
    'workflow_run.completed-fork',
  ])('%s parses with WorkflowRunEventSchema', async (name) => {
    const { payload } = await loadGithubFixture(name);

    const result = WorkflowRunEventSchema.safeParse(payload);

    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('keeps the linked PR number and head SHA only', async () => {
    const { payload } = await loadGithubFixture('workflow_run.completed-failure');

    const run = WorkflowRunEventSchema.parse(payload).workflow_run;

    expect(run.pull_requests).toEqual([
      { number: 42, head: { sha: 'c3d4e5f60718293a4b5c6d7e8f9012345678901a' } },
    ]);
    expect(run).toMatchObject({ conclusion: 'failure', run_attempt: 1, workflow_id: 66600001 });
  });

  it('accepts a fork run with no linked PRs and a foreign head repository', async () => {
    const { payload } = await loadGithubFixture('workflow_run.completed-fork');

    const run = WorkflowRunEventSchema.parse(payload).workflow_run;

    expect(run.pull_requests).toEqual([]);
    expect(run.head_repository?.id).toBe(77700099);
  });
});
