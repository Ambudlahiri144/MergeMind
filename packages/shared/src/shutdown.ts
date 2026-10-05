import type { Logger } from 'pino';

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export type ShutdownStep = {
  name: string;
  run: () => Promise<void>;
};

/**
 * Runs cleanup steps in order on SIGTERM/SIGINT, then exits (Architecture.md §3: graceful
 * shutdown). A hung step cannot block exit past `timeoutMs`.
 */
export function registerGracefulShutdown(
  logger: Logger,
  steps: readonly ShutdownStep[],
  timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, 'process.shuttingDown');

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, 'process.shutdownTimedOut');
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    let hasFailed = false;
    for (const step of steps) {
      try {
        await step.run();
      } catch (error) {
        hasFailed = true;
        logger.error({ err: error, step: step.name }, 'process.shutdownStepFailed');
      }
    }
    logger.info({ hasFailed }, 'process.stopped');
    process.exit(hasFailed ? 1 : 0);
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => void shutdown(signal));
  }
}
