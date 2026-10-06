import {
  DismissFindingBodySchema,
  FindingParamsSchema,
  InstallationParamsSchema,
  RepositoryParamsSchema,
  RunParamsSchema,
  UpdateBudgetBodySchema,
  UpdateRepositoryBodySchema,
} from '@mergemind/shared';
import type { RequestHandler } from 'express';

import { validate } from '../middleware/validate.js';
import type { ActionsService } from '../services/actions.service.js';

// Write endpoints (Architecture.md §5): 200 for an applied change, 202 for queued work.

export function updateRepository(service: ActionsService): RequestHandler {
  return validate(
    { params: RepositoryParamsSchema, body: UpdateRepositoryBodySchema },
    async ({ user, params, body }) => ({
      status: 200,
      body: await service.setEnabled(user, params.repositoryId, body.isEnabled),
    }),
  );
}

export function reindexRepository(service: ActionsService): RequestHandler {
  return validate({ params: RepositoryParamsSchema }, async ({ user, params }) => ({
    status: 202,
    body: await service.reindex(user, params.repositoryId),
  }));
}

export function rerunRun(service: ActionsService): RequestHandler {
  return validate({ params: RunParamsSchema }, async ({ user, params }) => ({
    status: 202,
    body: await service.rerun(user, params.runId),
  }));
}

export function dismissFinding(service: ActionsService): RequestHandler {
  return validate(
    { params: FindingParamsSchema, body: DismissFindingBodySchema },
    async ({ user, params, body }) => ({
      status: 200,
      body: await service.dismiss(user, params.findingId, body),
    }),
  );
}

export function updateBudget(service: ActionsService): RequestHandler {
  return validate(
    { params: InstallationParamsSchema, body: UpdateBudgetBodySchema },
    async ({ user, params, body }) => ({
      status: 200,
      body: await service.setBudget(user, params.installationId, body.monthlyTokenBudget),
    }),
  );
}
