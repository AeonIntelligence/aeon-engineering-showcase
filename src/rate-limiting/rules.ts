/**
 * Rate-limit configuration registry — the single source of truth for every
 * inbound rate limit in the application. Routes reference a label; they never
 * hardcode a count or window. Adding a new throttled surface means adding a
 * rule here, not scattering literals across route handlers.
 */

export type RateLimitKeyBy = "ip" | "user" | "client";

export interface RateLimitRule {
  readonly label: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly keyBy: RateLimitKeyBy;
}

export const RATE_LIMITS = {
  "auth-login": { label: "auth-login", limit: 10, windowSeconds: 900, keyBy: "ip" },
  "auth-forgot-password": {
    label: "auth-forgot-password",
    limit: 5,
    windowSeconds: 900,
    keyBy: "ip",
  },
  leads: { label: "leads", limit: 5, windowSeconds: 900, keyBy: "ip" },
  "dashboard-chat": { label: "dashboard-chat", limit: 30, windowSeconds: 60, keyBy: "user" },
  "knowledge-seed": { label: "knowledge-seed", limit: 5, windowSeconds: 300, keyBy: "user" },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitLabel = keyof typeof RATE_LIMITS;
