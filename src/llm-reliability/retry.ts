import { classifyError, isRetryableError } from "./error-classification.ts";
import { getLogger } from "../observability/logger.ts";

export { isRetryableError } from "./error-classification.ts";

const log = getLogger("retry");

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly label?: string;
}

/**
 * Retry an async operation on transient / retryable errors with exponential
 * back-off + jitter.  Non-retryable errors are re-thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 250, label = "operation" } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !isRetryableError(err)) throw err;
      const jitter = Math.random() * baseDelayMs;
      const delay = baseDelayMs * 2 ** (attempt - 1) + jitter;
      log.warn("retry attempt failed, retrying", {
        label,
        attempt,
        maxAttempts,
        delayMs: Math.round(delay),
        errorClassification: classifyError(err),
      });
      await sleep(delay);
    }
  }

  throw new Error(`[retry] ${label} exhausted ${maxAttempts} attempts`);
}

/**
 * Drop-in replacement for `fetch` that retries on transient network errors
 * (ECONNRESET, socket hang up, etc.) with exponential back-off + jitter.
 */
export function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return withRetry(() => fetch(input, init), {
    label: "fetch",
    maxAttempts: 3,
    baseDelayMs: 300,
  });
}
