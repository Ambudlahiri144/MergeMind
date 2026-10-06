import {
  FindingParamsSchema,
  InstallationParamsSchema,
  PageQuerySchema,
  PullListQuerySchema,
  PullParamsSchema,
  RepositoryParamsSchema,
  RunParamsSchema,
} from '@mergemind/shared';
import type { RequestHandler } from 'express';

import { validate } from '../middleware/validate.js';
import type { InstallationsService } from '../services/installations.service.js';
import type { PullsService } from '../services/pulls.service.js';
import type { RepositoriesService } from '../services/repositories.service.js';
import type { RunsService } from '../services/runs.service.js';

// Read endpoints (Architecture.md §5): parse -> service -> 200.

export function listRepositories(service: RepositoriesService): RequestHandler {
  return validate(
    { params: InstallationParamsSchema, query: PageQuerySchema },
    async ({ user, params, query }) => ({
      status: 200,
      body: await service.list(user, params.installationId, query),
    }),
  );
}

export function getRepository(service: RepositoriesService): RequestHandler {
  return validate({ params: RepositoryParamsSchema }, async ({ user, params }) => ({
    status: 200,
    body: await service.get(user, params.repositoryId),
  }));
}

export function getPolicy(service: RepositoriesService): RequestHandler {
  return validate({ params: RepositoryParamsSchema }, async ({ user, params }) => ({
    status: 200,
    body: await service.policy(user, params.repositoryId),
  }));
}

export function listPulls(service: PullsService): RequestHandler {
  return validate(
    { params: RepositoryParamsSchema, query: PullListQuerySchema },
    async ({ user, params, query }) => ({
      status: 200,
      body: await service.list(user, params.repositoryId, query),
    }),
  );
}

export function getPull(service: PullsService): RequestHandler {
  return validate({ params: PullParamsSchema }, async ({ user, params }) => ({
    status: 200,
    body: await service.detail(user, params.repositoryId, params.number),
  }));
}

export function getRun(service: RunsService): RequestHandler {
  return validate({ params: RunParamsSchema }, async ({ user, params }) => ({
    status: 200,
    body: await service.detail(user, params.runId),
  }));
}

export function getSnippet(service: RunsService): RequestHandler {
  return validate({ params: FindingParamsSchema }, async ({ user, params }) => ({
    status: 200,
    body: await service.snippet(user, params.findingId),
  }));
}

export function getUsage(service: InstallationsService): RequestHandler {
  return validate({ params: InstallationParamsSchema }, async ({ user, params }) => ({
    status: 200,
    body: await service.usage(user, params.installationId),
  }));
}
