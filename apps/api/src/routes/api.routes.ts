import type { GithubApp } from '@mergemind/github';
import { ServiceUnavailableError } from '@mergemind/shared';
import { Router } from 'express';

import {
  dismissFinding,
  reindexRepository,
  rerunRun,
  updateBudget,
  updateRepository,
} from '../controllers/actions.controller.js';
import { getMe } from '../controllers/me.controller.js';
import {
  getPolicy,
  getPull,
  getRepository,
  getRun,
  getSnippet,
  getUsage,
  listPulls,
  listRepositories,
} from '../controllers/read.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { createRateLimiter, type RateLimitOptions } from '../middleware/rate-limit.js';
import type { IndexProducer } from '../queues/index.producer.js';
import type { ReviewProducer } from '../queues/review.producer.js';
import type { AccessService } from '../services/access.service.js';
import { createActionsService } from '../services/actions.service.js';
import { createInstallationsService } from '../services/installations.service.js';
import { createPullsService } from '../services/pulls.service.js';
import { createRepositoriesService } from '../services/repositories.service.js';
import { createRunsService } from '../services/runs.service.js';
import { createScopeService, type ApiStores } from '../services/scope.service.js';

export type ApiRouterDeps = {
  /** Null when `API_JWT_SECRET` is unset: every authenticated route answers 503. */
  jwtSecret: string | null;
  rateLimit: RateLimitOptions;
  access: AccessService;
  stores: ApiStores;
  /** Null when the GitHub App is not configured: policy and snippets answer 503. */
  github: GithubApp | null;
  reviewProducer: ReviewProducer;
  indexProducer: IndexProducer;
  now: () => Date;
};

/**
 * The authenticated `/api/v1` surface (Architecture.md §5). Mounted after health and ready,
 * so those stay public; every route here needs a web-minted bearer token (ADR-029).
 */
export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();
  const { jwtSecret } = deps;
  if (jwtSecret === null) {
    router.use(() => {
      throw new ServiceUnavailableError('The API is not configured for sign-in (API_JWT_SECRET)');
    });
    return router;
  }
  const scope = createScopeService(deps.stores, deps.access);
  const services = { stores: deps.stores, scope, github: deps.github, now: deps.now };
  const repositories = createRepositoriesService(services);
  const pulls = createPullsService(services);
  const runs = createRunsService(services);
  const installations = createInstallationsService(services);
  const actions = createActionsService({
    ...services,
    reviewProducer: deps.reviewProducer,
    indexProducer: deps.indexProducer,
  });

  router.use(authenticate(jwtSecret));
  router.use(createRateLimiter(deps.rateLimit));

  router.get('/me', getMe(deps.access));
  router.get('/installations/:installationId/repositories', listRepositories(repositories));
  router.get('/installations/:installationId/usage', getUsage(installations));
  router.get('/repositories/:repositoryId', getRepository(repositories));
  router.get('/repositories/:repositoryId/policy', getPolicy(repositories));
  router.get('/repositories/:repositoryId/pulls', listPulls(pulls));
  router.get('/repositories/:repositoryId/pulls/:number', getPull(pulls));
  router.get('/runs/:runId', getRun(runs));
  router.get('/findings/:findingId/snippet', getSnippet(runs));

  router.patch('/repositories/:repositoryId', updateRepository(actions));
  router.post('/repositories/:repositoryId/reindex', reindexRepository(actions));
  router.post('/runs/:runId/rerun', rerunRun(actions));
  router.patch('/findings/:findingId', dismissFinding(actions));
  router.put('/installations/:installationId/budget', updateBudget(actions));
  return router;
}
