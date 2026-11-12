/**
 * Reusable async concurrency limiter (in-house semaphore primitive).
 *
 * Bounds how many wrapped async operations run at once: `run` acquires a slot
 * (queueing behind a pending resolver when the cap is reached) and releases it
 * in `finally`. Pure language features only — zero internal imports.
 */

export interface ConcurrencyLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active++;
        resolve();
      });
    });
  };

  const release = (): void => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
