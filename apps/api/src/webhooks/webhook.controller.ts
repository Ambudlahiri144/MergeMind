import {
  GITHUB_SIGNATURE_HEADER,
  UnauthorizedError,
  ValidationError,
  WebhookHeadersSchema,
  validationErrorFromZod,
} from '@mergemind/shared';
import type { RequestHandler } from 'express';

import type { WebhookService } from '../services/webhook.service.js';
import { isValidWebhookSignature } from './verify-signature.js';

const HTTP_ACCEPTED = 202;

export type WebhookControllerDeps = {
  secret: string;
  service: WebhookService;
};

function parseJsonBody(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    throw new ValidationError('Webhook body is not valid JSON', [], { cause: error });
  }
}

/** Verify, then hand off; slow work never runs in this request (rules.md §4). */
export function createWebhookController(deps: WebhookControllerDeps): RequestHandler {
  return async (req, res) => {
    const headers = WebhookHeadersSchema.safeParse(req.headers);
    if (!headers.success) {
      throw validationErrorFromZod('Missing or invalid GitHub webhook headers', headers.error);
    }

    // express.raw leaves req.body unset when there is no body; an empty body fails the HMAC.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidWebhookSignature(rawBody, req.headers[GITHUB_SIGNATURE_HEADER], deps.secret)) {
      throw new UnauthorizedError('Invalid webhook signature');
    }

    const outcome = await deps.service.process({
      event: headers.data['x-github-event'],
      deliveryId: headers.data['x-github-delivery'],
      payload: parseJsonBody(rawBody),
    });
    req.log.info({ event: headers.data['x-github-event'], ...outcome }, 'webhook.processed');
    res.status(HTTP_ACCEPTED).json(outcome);
  };
}
