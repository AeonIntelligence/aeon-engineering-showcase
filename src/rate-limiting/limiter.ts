/**
 * Core rate limiter.
 *
 * Pattern: Factory (GoF) — `createRateLimiter` closes over a store and a rule
 * and returns a `RateLimiter` with a single `check` method. Fail-open lives
 * here and nowhere else: when the store returns `null` (any backend failure),
 * `check` returns ALLOW. No caller may construct an allow/deny decision itself.
 */

import type { RateLimitDecision, RateLimitStore } from "./store.ts";
import type { RateLimitRule } from "./rules.ts";

export interface RateLimiter {
  readonly check: (identifier: string) => Promise<RateLimitDecision>;
}

const ALLOW: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

export function createRateLimiter(store: RateLimitStore, rule: RateLimitRule): RateLimiter {
  return {
    check: async (identifier) => {
      const decision = await store.hit(rule.label, identifier, rule.limit, rule.windowSeconds);
      return decision ?? ALLOW;
    },
  };
}
