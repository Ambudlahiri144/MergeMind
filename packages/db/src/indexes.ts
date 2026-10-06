import { CodeChunkModel } from './models/code-chunk.model.js';
import { FindingModel } from './models/finding.model.js';
import { InstallationModel } from './models/installation.model.js';
import { PullRequestModel } from './models/pull-request.model.js';
import { RepositoryModel } from './models/repository.model.js';
import { ReviewRunModel } from './models/review-run.model.js';
import { SuppressionModel } from './models/suppression.model.js';
import { UsageLedgerModel } from './models/usage-ledger.model.js';
import { WebhookDeliveryModel } from './models/webhook-delivery.model.js';

const MODELS = [
  InstallationModel,
  RepositoryModel,
  PullRequestModel,
  WebhookDeliveryModel,
  ReviewRunModel,
  FindingModel,
  SuppressionModel,
  UsageLedgerModel,
  CodeChunkModel,
];

/**
 * Builds every declared index (unique keys back idempotency, so they must exist before traffic).
 * Call once after `connectMongo` at boot and in integration tests.
 */
export async function ensureDbIndexes(): Promise<void> {
  await Promise.all(MODELS.map((model) => model.init()));
}
