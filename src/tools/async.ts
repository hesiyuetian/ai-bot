export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Error message plus the network cause, so Actions logs say "fetch failed (UND_ERR_SOCKET)"
 * instead of a bare "fetch failed".
 */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  const code = cause instanceof Error && "code" in cause ? String(cause.code) : "";
  return code ? `${error.message} (${code})` : error.message;
};

/** Runs the tasks one after another, pausing between them; for APIs that rate-limit bursts. */
export const inSequence = <T>(tasks: readonly (() => Promise<T>)[], gapMs: number): Promise<T[]> =>
  tasks.reduce<Promise<T[]>>(async (collected, task, index) => {
    const results = await collected;
    if (index > 0) await sleep(gapMs);
    return [...results, await task()];
  }, Promise.resolve([]));

/** Calls `attempt` until it succeeds, waiting a little longer after each failure. */
export const withRetry = async <T>(
  attempt: (attemptIndex: number) => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  attemptIndex = 0,
): Promise<T> => {
  try {
    return await attempt(attemptIndex);
  } catch (error: unknown) {
    if (attemptIndex + 1 >= maxAttempts) throw error;
    await sleep(delayMs * (attemptIndex + 1));
    return withRetry(attempt, maxAttempts, delayMs, attemptIndex + 1);
  }
};
