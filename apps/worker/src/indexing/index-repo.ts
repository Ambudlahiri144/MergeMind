import { createHash } from 'node:crypto';

import {
  MAX_CHUNKS_PER_REPO,
  type CodeChunkInput,
  type CodeChunksRepository,
  type InstallationsRepository,
  type RepositoriesRepository,
  type UsageLedgerRepository,
} from '@mergemind/db';
import {
  parseRepoFullName,
  type GithubApp,
  type GithubInstallationClient,
  type RepoRef,
} from '@mergemind/github';
import { isProviderAllowed, type Embedder } from '@mergemind/llm';
import {
  POLICY_FILE_PATH,
  createIgnoreMatcher,
  parsePolicy,
  usagePeriod,
  type IndexRepoJobData,
} from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';
import pLimit from 'p-limit';

import { escalateVisibility } from '../repository-visibility.js';
import { chunkFile, type FileChunk } from './chunker/chunk-file.js';
import {
  looksMinified,
  selectIndexableFiles,
  type IndexLimits,
  type TreeEntry,
} from './select-files.js';

const BLOB_CONCURRENCY = 4;
const COMPARE_FILE_CAP = 300;

export type IndexDeps = {
  installations: InstallationsRepository;
  repositories: RepositoriesRepository;
  codeChunks: CodeChunksRepository;
  usageLedger: UsageLedgerRepository;
  github: GithubApp;
  embedder: Embedder;
  logger: Logger;
  now: () => Date;
  limits: IndexLimits;
};

export type IndexOutcome =
  | { status: 'skipped'; reason: string }
  | {
      status: 'indexed';
      mode: 'full' | 'incremental';
      sha: string;
      filesIndexed: number;
      chunksEmbedded: number;
      chunksDeleted: number;
      isCapped: boolean;
    };

/** The text that gets embedded: location + symbol help retrieval match callers and names. */
function embeddingText(path: string, chunk: FileChunk): string {
  return `${path}\n${chunk.symbol}\n${chunk.content}`;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Paths to (re)index and paths to delete: everything in the tree for a full index, or only what
 * changed since `lastIndexedSha` when GitHub can compare (same rules as ADR-023).
 */
async function planChanges(
  client: GithubInstallationClient,
  repoRef: RepoRef,
  lastIndexedSha: string | undefined,
  headSha: string,
): Promise<{ mode: 'full' } | { mode: 'incremental'; changed: Set<string>; removed: string[] }> {
  if (lastIndexedSha === undefined) {
    return { mode: 'full' };
  }
  const compare = await client.compareCommits({ ...repoRef, base: lastIndexedSha, head: headSha });
  if (compare?.status !== 'ahead' || compare.files.length >= COMPARE_FILE_CAP) {
    return { mode: 'full' };
  }
  const changed = new Set<string>();
  const removed: string[] = [];
  for (const file of compare.files) {
    if (file.status === 'removed') {
      removed.push(file.filename);
      continue;
    }
    changed.add(file.filename);
    if (file.previous_filename !== undefined) {
      removed.push(file.previous_filename);
    }
  }
  return { mode: 'incremental', changed, removed };
}

/**
 * `index.repo` (PRD F6, ADR-024): chunk the default branch by symbol, embed changed chunks with
 * Ollama, upsert them into `codeChunks`, and drop chunks of deleted files and symbols. Idempotent:
 * an already-indexed head is skipped and unchanged content is never re-embedded.
 */
export async function runIndex(data: IndexRepoJobData, deps: IndexDeps): Promise<IndexOutcome> {
  const log = deps.logger.child({ repo: data.repoFullName, trigger: data.trigger });
  const known = await deps.repositories.findByGithubRepoId(data.githubRepoId);
  if (!known) {
    return { status: 'skipped', reason: 'unknown_repository' };
  }
  let repository = await escalateVisibility(known, data.isPrivate, deps.repositories);
  if (!repository.isInstalled || !repository.isEnabled) {
    return { status: 'skipped', reason: 'repository_disabled' };
  }
  const installation = await deps.installations.findByGithubId(data.githubInstallationId);
  // Embeddings send code to a provider: private repos need it on the allowlist (ADR-007).
  if (
    installation === null ||
    !isProviderAllowed('ollama', {
      isPrivateRepo: repository.isPrivate,
      allowedProviders: installation.allowedProviders,
    })
  ) {
    return { status: 'skipped', reason: 'embedding_provider_not_allowed' };
  }

  const repoRef = parseRepoFullName(data.repoFullName);
  const client = await deps.github.forInstallation(data.githubInstallationId);
  let defaultBranch = data.defaultBranch ?? repository.defaultBranch;
  if (defaultBranch === undefined) {
    const info = await client.getRepositoryInfo(repoRef);
    defaultBranch = info.defaultBranch;
    await deps.repositories.setDefaultBranch(repository.id, defaultBranch);
    // A live read is authoritative both ways (ADR-027).
    if (info.isPrivate !== repository.isPrivate) {
      await deps.repositories.updateFromGithub(repository.githubRepoId, {
        isPrivate: info.isPrivate,
      });
      repository = { ...repository, isPrivate: info.isPrivate };
    }
  }
  const head = await client.getBranchHead({ ...repoRef, branch: defaultBranch });
  // A reindex asked from the UI always runs: a full pass over the tree, where unchanged
  // content is still not re-embedded (ADR-031).
  const isManual = data.trigger === 'manual';
  if (!isManual && repository.lastIndexedSha === head.sha && repository.indexStatus === 'ready') {
    return { status: 'skipped', reason: 'already_indexed' };
  }

  await deps.repositories.setIndexStatus(repository.id, 'indexing');
  try {
    const [plan, tree, policyText] = await Promise.all([
      isManual
        ? Promise.resolve({ mode: 'full' as const })
        : planChanges(client, repoRef, repository.lastIndexedSha, head.sha),
      client.getTree({ ...repoRef, treeSha: head.treeSha }),
      client.getFileText({ ...repoRef, path: POLICY_FILE_PATH, ref: head.sha }),
    ]);
    const isIgnored = createIgnoreMatcher(parsePolicy(policyText).policy.review.ignorePaths);
    const { files: indexable, isCapped } = selectIndexableFiles(
      tree.entries,
      isIgnored,
      deps.limits,
    );
    const indexablePaths = new Set(indexable.map((entry) => entry.path));

    // Files to (re)chunk, and chunk paths to drop entirely.
    let toIndex: TreeEntry[];
    let toDelete: string[];
    if (plan.mode === 'incremental') {
      toIndex = indexable.filter((entry) => plan.changed.has(entry.path));
      toDelete = [
        ...plan.removed,
        // Changed files that are no longer indexable (moved under dist/, now ignored, too big).
        ...[...plan.changed].filter((path) => !indexablePaths.has(path)),
      ];
    } else {
      toIndex = indexable;
      toDelete = (await deps.codeChunks.listPaths(repository.id)).filter(
        (path) => !indexablePaths.has(path),
      );
    }

    const limit = pLimit(BLOB_CONCURRENCY);
    const chunked = await Promise.all(
      toIndex.map((entry) =>
        limit(async () => {
          const source = await client.getBlobText({ ...repoRef, sha: entry.sha });
          if (looksMinified(source)) {
            return { path: entry.path, language: '', chunks: [] as FileChunk[] };
          }
          const result = await chunkFile(entry.path, source);
          return {
            path: entry.path,
            language: result?.language ?? '',
            chunks: result?.chunks ?? [],
          };
        }),
      ),
    );

    // Embed only chunks whose content changed; respect the per-repo chunk cap.
    const existing = await deps.codeChunks.hashesForPaths(
      repository.id,
      toIndex.map((entry) => entry.path),
    );
    let room = MAX_CHUNKS_PER_REPO - (await deps.codeChunks.countForRepo(repository.id));
    const pending: { path: string; language: string; chunk: FileChunk; hash: string }[] = [];
    for (const file of chunked) {
      const known = existing.get(file.path);
      for (const chunk of file.chunks) {
        const hash = contentHash(chunk.content);
        const isNew = known?.get(chunk.symbol) === undefined;
        if (known?.get(chunk.symbol) === hash) {
          continue;
        }
        if (isNew && room <= 0) {
          continue;
        }
        if (isNew) {
          room -= 1;
        }
        pending.push({ path: file.path, language: file.language, chunk, hash });
      }
    }

    const startedAt = deps.now().getTime();
    const { embeddings, tokens } = await deps.embedder.embedDocuments(
      pending.map(({ path, chunk }) => embeddingText(path, chunk)),
    );
    const chunks: CodeChunkInput[] = pending.map(({ path, language, chunk, hash }, index) => ({
      path,
      symbol: chunk.symbol,
      name: chunk.name,
      kind: chunk.kind,
      language,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      contentHash: hash,
      content: chunk.content,
      embedding: embeddings[index] ?? [],
      embeddingModel: deps.embedder.model,
      commitSha: head.sha,
    }));
    await deps.codeChunks.upsertMany(repository.id, chunks);
    if (pending.length > 0) {
      await deps.usageLedger.record([
        {
          installationId: installation.id,
          repositoryId: repository.id,
          kind: 'embed',
          provider: 'ollama',
          model: deps.embedder.model,
          inputTokens: tokens,
          outputTokens: 0,
          latencyMs: Math.max(0, deps.now().getTime() - startedAt),
          isFallback: false,
          period: usagePeriod(deps.now()),
        },
      ]);
    }

    let chunksDeleted = await deps.codeChunks.deleteForPaths(repository.id, toDelete);
    for (const file of chunked) {
      chunksDeleted += await deps.codeChunks.deleteStale(
        repository.id,
        file.path,
        file.chunks.map((chunk) => chunk.symbol),
      );
    }
    await deps.codeChunks.touchCommit(
      repository.id,
      toIndex.map((entry) => entry.path),
      head.sha,
    );
    await deps.repositories.markIndexed(repository.id, head.sha);

    const outcome: IndexOutcome = {
      status: 'indexed',
      mode: plan.mode,
      sha: head.sha,
      filesIndexed: toIndex.length,
      chunksEmbedded: chunks.length,
      chunksDeleted,
      isCapped: isCapped || tree.isTruncated,
    };
    log.info(outcome, 'index.completed');
    return outcome;
  } catch (error) {
    await deps.repositories.setIndexStatus(repository.id, 'failed');
    throw error;
  }
}
