import { describe, expect, it } from 'vitest';

import { routeWebhook } from './route-webhook.js';

describe('routeWebhook', () => {
  it.each(['created', 'deleted', 'suspend', 'unsuspend'])('routes installation.%s', (action) => {
    expect(routeWebhook('installation', action)).toEqual({ kind: 'installation' });
  });

  it.each(['added', 'removed'])('routes installation_repositories.%s', (action) => {
    expect(routeWebhook('installation_repositories', action)).toEqual({
      kind: 'installation_repositories',
    });
  });

  it.each(['opened', 'reopened', 'synchronize', 'ready_for_review'])(
    'routes pull_request.%s to a review with that trigger',
    (action) => {
      expect(routeWebhook('pull_request', action)).toEqual({
        kind: 'pull_request_review',
        trigger: action,
      });
    },
  );

  it('routes pull_request.closed to the close handler', () => {
    expect(routeWebhook('pull_request', 'closed')).toEqual({ kind: 'pull_request_closed' });
  });

  it.each([
    ['pull_request', 'labeled'],
    ['pull_request', undefined],
    ['installation', 'new_permissions_accepted'],
    ['installation_repositories', 'renamed'],
  ])('ignores %s.%s as unsupported_action', (event, action) => {
    expect(routeWebhook(event, action)).toEqual({ kind: 'ignored', reason: 'unsupported_action' });
  });

  it('routes push to the index handler', () => {
    expect(routeWebhook('push', undefined)).toEqual({ kind: 'push' });
  });

  it.each(['workflow_run'])('ignores %s until its phase lands', (event) => {
    expect(routeWebhook(event, 'completed')).toEqual({
      kind: 'ignored',
      reason: 'not_yet_supported',
    });
  });

  it.each(['ping', 'issues', 'star'])('ignores %s as unsupported_event', (event) => {
    expect(routeWebhook(event, undefined)).toEqual({
      kind: 'ignored',
      reason: 'unsupported_event',
    });
  });
});
