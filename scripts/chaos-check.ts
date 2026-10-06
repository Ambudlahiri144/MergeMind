// PRD §7 chaos check: kill the worker mid-review, restart it, and confirm the retry posts no
// duplicate review or comment (ADR-018's crash-safety, live). The deterministic version is
// the integration test "adopts the posted review after a crash right after createReview".
//
// 1. Stop your dev worker (`npm run dev` worker), so the review job waits in Redis.
// 2. Open (or push to) a small PR on an installed repository.
// 3. npm run chaos:check -- <owner/repo> <pr> [--at llm|publishing|posted]
//
//   --at llm         kill once the LLM passes start (context retrieved)
//   --at publishing  kill just before the review is posted
//   --at posted      kill right after GitHub accepted the review (default: the risky window)
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  connectMongo,
  createInstallationsRepository,
  createRepositoriesRepository,
  disconnectMongo,
} from '@mergemind/db';
import {
  createGithubApp,
  extractFingerprint,
  parseRepoFullName,
  runMarker,
} from '@mergemind/github';
import { QUEUE_NAMES, parseEnv } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

const KILL_POINTS = {
  llm: 'review.contextRetrieved',
  publishing: 'review.publishing',
  posted: 'review.posted',
} as const;
const JOB_WAIT_MS = 5 * 60 * 1000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logger = createLogger({ name: 'chaos-check', level: 'info' });

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((pem) => pem.replace(/\\n/g, '\n')),
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { at: { type: 'string', default: 'posted' } },
});
const [repoFullName, prArg] = positionals;
const killPoint = (KILL_POINTS as Record<string, string | undefined>)[values.at];

type LogLine = { msg?: string; jobId?: string; runId?: string };

/** Starts a real worker as one node process (killable outright) and streams its JSON logs. */
function startWorker(onLine: (line: LogLine) => void): ChildProcess {
  const child = spawn(
    process.execPath,
    ['--conditions=@mergemind/source', '--import', 'tsx', 'apps/worker/src/main.ts'],
    { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  createInterface({ input: child.stdout }).on('line', (text) => {
    try {
      onLine(JSON.parse(text) as LogLine);
    } catch {
      // Not a log line.
    }
  });
  return child;
}

function waitFor<T>(register: (resolve: (value: T) => void) => void, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
    }, JOB_WAIT_MS);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function main(): Promise<number> {
  if (!repoFullName || !prArg || !/^\d+$/.test(prArg) || !killPoint) {
    logger.error('usage: npm run chaos:check -- <owner/repo> <pr> [--at llm|publishing|posted]');
    return 2;
  }
  const prNumber = Number(prArg);
  const env = parseEnv(EnvSchema, process.env);
  await connectMongo(env.MONGODB_URI);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAMES.review, { connection: redis });
  try {
    const repository = await createRepositoriesRepository().findByFullName(repoFullName);
    const installation = repository
      ? await createInstallationsRepository().findById(repository.installationId)
      : null;
    if (!repository || !installation) {
      logger.error({ repoFullName }, 'chaos.unknownRepository');
      return 2;
    }
    if ((await queue.getWorkers()).length > 0) {
      logger.error('chaos.workerRunning: stop the dev worker first, so this check owns the job');
      return 2;
    }
    const prefix = `${String(repository.githubRepoId)}#${String(prNumber)}@`;
    const waiting = (await queue.getJobs(['waiting', 'delayed', 'prioritized'], 0, 200)).find(
      (job) => job.id?.startsWith(prefix),
    );
    if (!waiting?.id) {
      logger.error(
        { prefix },
        'chaos.noQueuedJob: push to the PR (or open it) while the worker is stopped',
      );
      return 2;
    }
    const jobId = waiting.id;
    logger.info({ jobId, killPoint }, 'chaos.started');

    // Round 1: kill the worker at the chosen point.
    let runId: string | undefined;
    const first = startWorker((line) => {
      if (line.jobId === jobId && line.runId) {
        runId = line.runId;
      }
      if (line.jobId === jobId && line.msg === killPoint) {
        first.kill('SIGKILL');
      }
    });
    await waitFor<null>((resolve) => {
      first.once('exit', () => {
        resolve(null);
      });
    }, 'the kill point');
    logger.info({ jobId, runId }, 'chaos.killed');

    // Round 2: a fresh worker picks the retry up and must finish without duplicating anything.
    let resolveDone: ((line: LogLine) => void) | undefined;
    const retried = waitFor<LogLine>((resolve) => {
      resolveDone = resolve;
    }, 'the retried review');
    const second = startWorker((line) => {
      if (
        line.jobId === jobId &&
        ['review.completed', 'review.replayed'].includes(line.msg ?? '')
      ) {
        runId ??= line.runId;
        resolveDone?.(line);
      }
    });
    const done = await retried;
    second.kill('SIGTERM');
    logger.info({ jobId, outcome: done.msg }, 'chaos.retried');

    // Verify on GitHub.
    const github = createGithubApp({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      logger,
    });
    const client = await github.forInstallation(installation.githubInstallationId);
    const repoRef = parseRepoFullName(repoFullName);
    const reviews = runId
      ? (await client.listReviews({ ...repoRef, pullNumber: prNumber })).filter((review) =>
          review.body.includes(runMarker(runId ?? '')),
        )
      : [];
    const fingerprints = (
      await client.listPullRequestComments({ ...repoRef, pullNumber: prNumber })
    )
      .filter((comment) => comment.inReplyToId === null)
      .map((comment) => extractFingerprint(comment.body))
      .filter((fingerprint): fingerprint is string => fingerprint !== null);
    const duplicates = fingerprints.filter((value, index) => fingerprints.indexOf(value) !== index);
    const isPassed = reviews.length <= 1 && duplicates.length === 0;
    logger.info(
      { runId, reviewsWithRunMarker: reviews.length, duplicateFingerprints: duplicates.length },
      isPassed ? 'chaos.PASS' : 'chaos.FAIL',
    );
    return isPassed ? 0 : 1;
  } finally {
    await queue.close();
    await redis.quit();
    await disconnectMongo();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'chaos.crashed');
    process.exitCode = 1;
  });
