/**
 * Rate-limit storage backend.
 *
 * Pattern: Strategy (GoF) — `RateLimitStore` is the abstraction the limiter
 * depends on. Production plugs in a database-backed fixed-window counter (an
 * atomic stored procedure); this showcase ships the in-memory implementation.
 * Either satisfies the same interface without touching the limiter or any
 * caller (Dependency Inversion).
 *
 * The store is the single place that translates a backend failure into a
 * fail-open signal: `hit` returns `null` on ANY error, and the limiter maps
 * `null` to "allow". A storage outage can therefore never degrade a throttled
 * route closed.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimitStore {
  /** Returns null on ANY backend failure so the caller can fail open. */
  readonly hit: (
    limiterKey: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<RateLimitDecision | null>;
}

interface WindowCounter {
  readonly windowStartMs: number;
  count: number;
}

/**
 * Fixed-window counter held in process memory. Suitable for a single instance
 * or tests; multi-instance deployments use a shared store behind the same
 * interface.
 */
export function createInMemoryRateLimitStore(now: () => number = Date.now): RateLimitStore {
  const windows = new Map<string, WindowCounter>();

  return {
    hit: async (limiterKey, identifier, limit, windowSeconds) => {
      try {
        const windowMs = windowSeconds * 1000;
        const currentMs = now();
        const windowStartMs = currentMs - (currentMs % windowMs);
        const key = `${limiterKey}:${identifier}`;

        const existing = windows.get(key);
        const counter =
          existing && existing.windowStartMs === windowStartMs
            ? existing
            : { windowStartMs, count: 0 };
        counter.count++;
        windows.set(key, counter);

        if (counter.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((windowStartMs + windowMs - currentMs) / 1000),
        };
      } catch {
        return null;
      }
    },
  };
}
