export class TimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejects with `TimeoutError` if `operation` does not settle within `timeoutMs`
 * (rules.md §6: every external call has a timeout). The timer never keeps the process alive.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
