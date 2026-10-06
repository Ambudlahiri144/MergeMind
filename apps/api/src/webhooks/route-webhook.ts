import {
  INSTALLATION_ACTIONS,
  INSTALLATION_REPOSITORIES_ACTIONS,
  REPOSITORY_ACTIONS,
  type ReviewTrigger,
} from '@mergemind/shared';

/** pull_request actions that start a review (PRD F2). */
const REVIEW_TRIGGER_ACTIONS: ReadonlySet<string> = new Set<ReviewTrigger>([
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
]);

export type IgnoreReason = 'unsupported_event' | 'unsupported_action';

export type WebhookRoute =
  | { kind: 'installation' }
  | { kind: 'installation_repositories' }
  | { kind: 'pull_request_review'; trigger: ReviewTrigger }
  | { kind: 'pull_request_closed' }
  | { kind: 'push' }
  | { kind: 'repository' }
  | { kind: 'workflow_run' }
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
    case 'repository':
      return isOneOf(REPOSITORY_ACTIONS, action)
        ? { kind: 'repository' }
        : { kind: 'ignored', reason: 'unsupported_action' };
    case 'workflow_run':
      // The handler decides by conclusion and linked PRs (PRD F10).
      return action === 'completed'
        ? { kind: 'workflow_run' }
        : { kind: 'ignored', reason: 'unsupported_action' };
    default:
      return { kind: 'ignored', reason: 'unsupported_event' };
  }
}
