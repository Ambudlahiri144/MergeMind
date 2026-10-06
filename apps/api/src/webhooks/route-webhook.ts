import {
  INSTALLATION_ACTIONS,
  INSTALLATION_REPOSITORIES_ACTIONS,
  type ReviewTrigger,
} from '@mergemind/shared';

/** pull_request actions that start a review (PRD F2). */
const REVIEW_TRIGGER_ACTIONS: ReadonlySet<string> = new Set<ReviewTrigger>([
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
]);

/** Events in Architecture.md §5 that later phases handle (workflow_run → Phase 5). */
const NOT_YET_SUPPORTED_EVENTS: ReadonlySet<string> = new Set(['workflow_run']);

export type IgnoreReason = 'unsupported_event' | 'unsupported_action' | 'not_yet_supported';

export type WebhookRoute =
  | { kind: 'installation' }
  | { kind: 'installation_repositories' }
  | { kind: 'pull_request_review'; trigger: ReviewTrigger }
  | { kind: 'pull_request_closed' }
  | { kind: 'push' }
  | { kind: 'ignored'; reason: IgnoreReason };

function isOneOf(values: readonly string[], action: string | undefined): boolean {
  return action !== undefined && values.includes(action);
}

/** Pure mapping from (event, action) to what the api does with it (Architecture.md §5 table). */
export function routeWebhook(event: string, action: string | undefined): WebhookRoute {
  switch (event) {
    case 'installation':
      return isOneOf(INSTALLATION_ACTIONS, action)
        ? { kind: 'installation' }
        : { kind: 'ignored', reason: 'unsupported_action' };
    case 'installation_repositories':
      return isOneOf(INSTALLATION_REPOSITORIES_ACTIONS, action)
        ? { kind: 'installation_repositories' }
        : { kind: 'ignored', reason: 'unsupported_action' };
    case 'pull_request':
      if (action !== undefined && REVIEW_TRIGGER_ACTIONS.has(action)) {
        return { kind: 'pull_request_review', trigger: action as ReviewTrigger };
      }
      return action === 'closed'
        ? { kind: 'pull_request_closed' }
        : { kind: 'ignored', reason: 'unsupported_action' };
    case 'push':
      // The handler keeps only default-branch pushes (it needs the payload to tell).
      return { kind: 'push' };
    default:
      return {
        kind: 'ignored',
        reason: NOT_YET_SUPPORTED_EVENTS.has(event) ? 'not_yet_supported' : 'unsupported_event',
      };
  }
}
