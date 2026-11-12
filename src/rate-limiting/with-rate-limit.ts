/**
 * Rate-limit attachment layer.
 *
 * Pattern: Decorator (GoF) — `withRateLimit` wraps a public route handler with
 * a per-IP throttle at the same convergence point the auth decorators use, so
 * no route handler contains inline throttling logic.
 *
 * `enforceRateLimit` is the shared convergence point for both the public
 * decorator here and the authenticated-route `rateLimit` option in
 * `../auth/with-auth.ts`. It is the single place that hashes the raw
 * identifier (so the counter store never sees a raw IP or user id), builds the
 * fail-open limiter, and — on a block only — emits telemetry and returns the 429.
 *
 * Handlers use the web-standard Request/Response types, so the same decorator
 * wraps Next.js route handlers or any fetch-style server.
 */

import { createHash } from "node:crypto";
import { RATE_LIMITS, type RateLimitLabel, type RateLimitRule } from "./rules.ts";
import { createInMemoryRateLimitStore, type RateLimitStore } from "./store.ts";
import { createRateLimiter } from "./limiter.ts";
import { getLogger } from "../observability/logger.ts";

const log = getLogger("rate-limit");

let activeStore: RateLimitStore = createInMemoryRateLimitStore();

/** Swap the backing store (shared database store in production, fakes in tests). */
export function configureRateLimitStore(store: RateLimitStore): void {
  activeStore = store;
}

/** First forwarded hop, then x-real-ip, then a shared "unknown" bucket. */
export function resolveClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

/** SHA-256 so the counter store holds a hash, never a raw IP or user id. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    {
      data: null,
      error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Shared convergence point. Hashes the raw identifier, runs the fail-open
 * limiter, and returns a 429 response (plus block telemetry) when the request
 * is over the limit. Returns null when the request may proceed.
 */
export async function enforceRateLimit(
  rule: RateLimitRule,
  rawIdentifier: string,
  clientId: string | null,
): Promise<Response | null> {
  const limiter = createRateLimiter(activeStore, rule);
  const decision = await limiter.check(hashIdentifier(rawIdentifier));
  if (decision.allowed) return null;
  // Telemetry never records the raw or hashed identifier.
  log.warn("rate_limit_block", { surface: rule.label, keyBy: rule.keyBy, clientId });
  return rateLimitedResponse(decision.retryAfterSeconds);
}

/**
 * Public-route decorator — per-IP throttle. The rule for `label` must be keyed
 * by IP; a misuse throws in non-production (a harmless no-op in production,
 * where the wrapped handler still runs).
 */
export function withRateLimit<TRouteCtx = unknown>(
  label: RateLimitLabel,
  handler: (request: Request, routeCtx: TRouteCtx) => Promise<Response>,
): (request: Request, routeCtx: TRouteCtx) => Promise<Response> {
  const rule = RATE_LIMITS[label];
  if (rule.keyBy !== "ip" && process.env.NODE_ENV !== "production") {
    throw new Error(
      `[rate-limit] withRateLimit requires a keyBy:"ip" rule but "${label}" uses "${rule.keyBy}"`,
    );
  }
  return async (request, routeCtx) => {
    const blocked = await enforceRateLimit(rule, resolveClientIp(request), null);
    if (blocked) return blocked;
    return handler(request, routeCtx);
  };
}
