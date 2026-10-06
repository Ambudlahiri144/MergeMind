import type {
  InstallationsRepository,
  PullRequestsRepository,
  RepositoriesRepository,
  WebhookDeliveriesRepository,
} from '@mergemind/db';
import {
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  PullRequestEventSchema,
  PushEventSchema,
  RepositoryEventSchema,
  WebhookActionSchema,
  WorkflowRunEventSchema,
  assertNever,
  isAppError,
  validationErrorFromZod,
} from '@mergemind/shared';
import type { z } from 'zod';

import type { CiSummaryProducer } from '../queues/ci-summary.producer.js';
import type { IndexProducer } from '../queues/index.producer.js';
import type { ReviewProducer } from '../queues/review.producer.js';
import type { HandlerResult } from '../webhooks/handlers/handler-result.js';
import {
  handleInstallationEvent,
  handleInstallationRepositoriesEvent,
} from '../webhooks/handlers/installation.handler.js';
import {
  handlePullRequestClosed,
  handlePullRequestReview,
} from '../webhooks/handlers/pull-request.handler.js';
import { handlePush } from '../webhooks/handlers/push.handler.js';
import { handleRepositoryEvent } from '../webhooks/handlers/repository.handler.js';
import { handleWorkflowRun } from '../webhooks/handlers/workflow-run.handler.js';
import { routeWebhook, type WebhookRoute } from '../webhooks/route-webhook.js';

const MAX_STORED_ERROR_LENGTH = 500;

export type WebhookServiceDeps = {
  deliveries: WebhookDeliveriesRepository;
  installations: InstallationsRepository;
  repositories: RepositoriesRepository;
  pullRequests: PullRequestsRepository;
  reviewProducer: ReviewProducer;
  indexProducer: IndexProducer;
  ciSummaryProducer: CiSummaryProducer;
};

export type IncomingWebhook = {
  event: string;
  deliveryId: string;
  payload: unknown;
};

export type WebhookOutcome = {
  deliveryId: string;
  status: HandlerResult['status'] | 'duplicate';
  reason: string;
  jobId?: string;
};

export type WebhookService = {
  process(webhook: IncomingWebhook): Promise<WebhookOutcome>;
};

function parsePayload<Schema extends z.ZodType>(
  schema: Schema,
  webhook: IncomingWebhook,
): z.infer<Schema> {
  const result = schema.safeParse(webhook.payload);
  if (!result.success) {
    throw validationErrorFromZod(`Invalid ${webhook.event} payload`, result.error);
  }
  return result.data;
}

function describeError(error: unknown): string {
  const message = isAppError(error) || error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_STORED_ERROR_LENGTH);
}

/**
 * Verified webhook → recorded once → handled or enqueued (Architecture.md §1 steps 2-3).
 * Any failure marks the delivery `failed`, so a GitHub redelivery can retry it.
 */
export function createWebhookService(deps: WebhookServiceDeps): WebhookService {
  async function dispatch(route: WebhookRoute, webhook: IncomingWebhook): Promise<HandlerResult> {
    switch (route.kind) {
      case 'installation':
        return handleInstallationEvent(parsePayload(InstallationEventSchema, webhook), deps);
      case 'installation_repositories':
        return handleInstallationRepositoriesEvent(
          parsePayload(InstallationRepositoriesEventSchema, webhook),
          deps,
        );
      case 'pull_request_review':
        return handlePullRequestReview(
          parsePayload(PullRequestEventSchema, webhook),
          { deliveryId: webhook.deliveryId, trigger: route.trigger },
          deps,
        );
      case 'pull_request_closed':
        return handlePullRequestClosed(parsePayload(PullRequestEventSchema, webhook), deps);
      case 'push':
        return handlePush(parsePayload(PushEventSchema, webhook), deps);
      case 'repository':
        return handleRepositoryEvent(parsePayload(RepositoryEventSchema, webhook), deps);
      case 'workflow_run':
        return handleWorkflowRun(parsePayload(WorkflowRunEventSchema, webhook), deps);
      case 'ignored':
        return { status: 'ignored', reason: route.reason };
      default:
        return assertNever(route, 'webhook route');
    }
  }

  return {
    async process(webhook) {
      const parsedAction = WebhookActionSchema.safeParse(webhook.payload);
      const action = parsedAction.success ? parsedAction.data.action : undefined;

      const claim = await deps.deliveries.claim({
        deliveryId: webhook.deliveryId,
        event: webhook.event,
        ...(action === undefined ? {} : { action }),
      });
      if (!claim.isClaimed) {
        return { deliveryId: webhook.deliveryId, status: 'duplicate', reason: claim.status };
      }

      try {
        const result = await dispatch(routeWebhook(webhook.event, action), webhook);
        await deps.deliveries.markStatus(webhook.deliveryId, result.status, {
          reason: result.reason,
        });
        return { deliveryId: webhook.deliveryId, ...result };
      } catch (error) {
        await deps.deliveries.markStatus(webhook.deliveryId, 'failed', {
          error: describeError(error),
        });
        throw error;
      }
    },
  };
}
