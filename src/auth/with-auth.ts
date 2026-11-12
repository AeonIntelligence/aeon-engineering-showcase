/**
 * Route decorator functions — declarative auth wrapping for API routes.
 *
 * Pattern: Decorator (GoF) — wraps route handler functions with cross-cutting
 * auth concerns. Route handlers receive a pre-resolved context and contain
 * zero auth code.
 *
 * Composition over inheritance — withAdminAuth and withClientAuth compose
 * withDashboardAuth rather than duplicating resolution logic.
 *
 * Identity resolution (session -> user -> organization membership) is injected
 * via `configureAuthResolver`, so the decorators depend on an abstraction
 * rather than a specific auth provider.
 */

import { RATE_LIMITS, type RateLimitLabel } from "../rate-limiting/rules.ts";
import { enforceRateLimit } from "../rate-limiting/with-rate-limit.ts";
import { getLogger } from "../observability/logger.ts";

const log = getLogger("withDashboardAuth");

export interface DashboardAuthContext {
  readonly userId: string;
  readonly role: "admin" | "member";
  readonly clientId: string | null;
}

export interface ClientAuthContext extends DashboardAuthContext {
  readonly clientId: string;
}

export class AuthError extends Error {
  readonly status: 401 | 403 | 500;
  readonly code: string;

  constructor(status: 401 | 403 | 500, code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export type AuthResolver = (request: Request) => Promise<DashboardAuthContext>;

let resolveAuth: AuthResolver = async () => {
  throw new AuthError(500, "AUTH_NOT_CONFIGURED", "No auth resolver configured.");
};

export function configureAuthResolver(resolver: AuthResolver): void {
  resolveAuth = resolver;
}

/** Optional cross-cutting behaviors for the auth decorators. */
export interface WithAuthOptions {
  /** Apply a per-user or per-client rate limit (registry label) post-auth. */
  readonly rateLimit?: RateLimitLabel;
}

type Handler<TCtx, TRouteCtx> = (
  request: Request,
  ctx: TCtx,
  routeCtx: TRouteCtx,
) => Promise<Response>;

type WrappedHandler<TRouteCtx> = (request: Request, routeCtx: TRouteCtx) => Promise<Response>;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ data: null, error: { code, message } }, { status });
}

/**
 * Per-identity rate-limit enforcement for authenticated routes. Keys by the
 * resolved user or client id (the rule decides which). Fails open when the
 * required id is not resolved. Throws in non-production if handed an IP rule
 * (public surfaces use `withRateLimit`, not the auth decorators).
 */
async function enforceAuthRateLimit(
  ctx: DashboardAuthContext,
  label: RateLimitLabel,
): Promise<Response | null> {
  const rule = RATE_LIMITS[label];
  if (rule.keyBy === "ip") {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `[rate-limit] auth decorators require a keyBy:"user"|"client" rule but "${label}" uses "ip"`,
      );
    }
    return null;
  }
  const rawIdentifier = rule.keyBy === "user" ? ctx.userId : ctx.clientId;
  if (!rawIdentifier) return null;
  return enforceRateLimit(rule, rawIdentifier, ctx.clientId);
}

/**
 * Wraps a route handler with authentication. Resolves identity once and maps
 * AuthError to a JSON response; unexpected errors never leak their message.
 */
export function withDashboardAuth<TRouteCtx = unknown>(
  handler: Handler<DashboardAuthContext, TRouteCtx>,
  options?: WithAuthOptions,
): WrappedHandler<TRouteCtx> {
  return async (request, routeCtx) => {
    try {
      const ctx = await resolveAuth(request);
      if (options?.rateLimit) {
        const blocked = await enforceAuthRateLimit(ctx, options.rateLimit);
        if (blocked) return blocked;
      }
      return await handler(request, ctx, routeCtx);
    } catch (err) {
      if (err instanceof AuthError && err.status !== 500) {
        return errorResponse(err.status, err.code, err.message);
      }
      log.error("Unhandled error", err);
      return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
  };
}

/** Admin-only. Composes withDashboardAuth and adds a role check (403 otherwise). */
export function withAdminAuth<TRouteCtx = unknown>(
  handler: Handler<DashboardAuthContext, TRouteCtx>,
  options?: WithAuthOptions,
): WrappedHandler<TRouteCtx> {
  return withDashboardAuth(async (request, ctx, routeCtx) => {
    if (ctx.role !== "admin") {
      return errorResponse(403, "FORBIDDEN", "Admin access required.");
    }
    return handler(request, ctx, routeCtx);
  }, options);
}

/**
 * Organization-scoped. Composes withDashboardAuth and guarantees a non-null
 * `ctx.clientId` to the handler (403 otherwise), so handlers never re-check it.
 */
export function withClientAuth<TRouteCtx = unknown>(
  handler: Handler<ClientAuthContext, TRouteCtx>,
  options?: WithAuthOptions,
): WrappedHandler<TRouteCtx> {
  return withDashboardAuth(async (request, ctx, routeCtx) => {
    if (!ctx.clientId?.trim()) {
      return errorResponse(403, "FORBIDDEN", "Client association required.");
    }
    return handler(request, ctx as ClientAuthContext, routeCtx);
  }, options);
}
