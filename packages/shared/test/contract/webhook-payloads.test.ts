import { describe, expect, it } from 'vitest';

import {
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  PullRequestEventSchema,
  WebhookActionSchema,
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
