/**
 * Two-layer redaction for the debug-logging firehose.
 *
 * Layer 1 (scrubContext) runs at emit time on every row regardless of tier: a
 * universal secret scrub plus long-value truncation. Layer 2 (applyTierRedaction)
 * runs at flush time, off the request path: restricted-tier clients keep only
 * identifier-shaped context values, everything else is suppressed. The tier is
 * resolved through an in-module TTL cache so a batch of rows costs at most one
 * lookup per distinct client per 5 minutes.
 *
 * Pattern: Strategy (tier decides the layer-2 transform) resolved lazily at the
 * flush convergence point, never per log call.
 */

export interface DebugLogRow {
  readonly client_id: string | null;
  readonly source: string;
  readonly message: string;
  context: Record<string, unknown> | null;
}

export type PrivacyTier = "standard" | "hipaa" | "privilege";

/** Looks up a client's configured privacy tier (a database read in production). */
export type PrivacyTierLookup = (clientId: string) => Promise<string | null>;

const SECRET_KEY_PATTERN = /token|secret|password|api[-_]?key|authorization|bearer|cookie/i;
const MAX_STRING_VALUE_CHARS = 2000;
const TRUNCATION_SUFFIX = "…[truncated:aeon]";

// Identifier allowlist — context keys whose VALUES survive tier redaction because
// they are structural identifiers/metadata, not customer content. Retained as an
// additional keep-rule for snake_case keys whose values are long composite ids
// that the value-shape rules below do not recognize (e.g. a >32-char trace token).
const IDENTIFIER_KEY_PATTERN =
  /(^|[_-])(id|ids|count|len|length|status|type|kind|channel|outcome|level|module|source|feature|trace|step|attempt|duration|ms)([_-]|$)/i;

/** Keys whose values are content-bearing and always redact under restricted
 * tiers, regardless of value shape. Matched case-insensitively as a whole key or
 * as the trailing snake_case/camelCase segment (e.g. "body", "bodyText",
 * "request_text"). `reason` and `citation` are denylisted because decision logs
 * route free-text model justifications through them. */
const CONTENT_KEY_DENYLIST = [
  "content",
  "body",
  "subject",
  "name",
  "email",
  "phone",
  "to",
  "from",
  "message",
  "text",
  "transcript",
  "address",
  "note",
  "reason",
  "citation",
  // A raw counterpart identifier (phone/email) is content; the keyed
  // `counterpartHash` key is unaffected — its whole key is not "counterpart"
  // and its trailing segment is "hash".
  "counterpart",
] as const;

// A value is structurally safe when it cannot carry free-text content: uuid,
// number, boolean, ISO timestamp, or a short enum-like token (no whitespace).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/;
const ENUM_TOKEN_PATTERN = /^[a-z0-9_.:/-]{1,32}$/i;

/** Splits a context key into lowercased word segments across snake_case,
 * kebab-case, and camelCase boundaries so denylist matching targets whole words
 * (so "auto" is not treated as ending in the denied word "to"). */
function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

export function isContentKey(key: string): boolean {
  const segments = keySegments(key);
  if (segments.length === 0) return false;
  const whole = key.toLowerCase();
  const last = segments[segments.length - 1];
  return CONTENT_KEY_DENYLIST.some((denied) => denied === whole || denied === last);
}

export function isStructurallySafeValue(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
  if (/\s/.test(value)) return false;
  return (
    UUID_PATTERN.test(value) || ISO_TIMESTAMP_PATTERN.test(value) || ENUM_TOKEN_PATTERN.test(value)
  );
}

/**
 * Layer 1 — emit-time scrub applied to every row: redact secret-shaped keys and
 * truncate over-long string values. Returns a new object; does not mutate input.
 */
export function scrubContext(
  context: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!context) return context;
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      scrubbed[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > MAX_STRING_VALUE_CHARS) {
      scrubbed[key] = value.slice(0, MAX_STRING_VALUE_CHARS) + TRUNCATION_SUFFIX;
      continue;
    }
    scrubbed[key] = value;
  }
  return scrubbed;
}

interface TierCacheEntry {
  readonly tier: PrivacyTier;
  readonly fetchedAt: number;
}

const TIER_CACHE_TTL_MS = 5 * 60 * 1000;
const tierCache = new Map<string, TierCacheEntry>();

/** Test hook — clears the tier cache between cases. */
export function resetTierCache(): void {
  tierCache.clear();
}

async function resolveTier(clientId: string, lookup: PrivacyTierLookup): Promise<PrivacyTier> {
  const cached = tierCache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < TIER_CACHE_TTL_MS) {
    return cached.tier;
  }
  try {
    const raw = await lookup(clientId);
    const tier: PrivacyTier =
      raw === "hipaa" || raw === "privilege" || raw === "standard" ? raw : "hipaa";
    tierCache.set(clientId, { tier, fetchedAt: Date.now() });
    return tier;
  } catch {
    // Fail safe — an unresolvable tier is treated as the most restrictive.
    return "hipaa";
  }
}

/**
 * Layer 2 — flush-time tier suppression. Groups rows by client, resolves each
 * client's privacy tier (cached), and for restricted-tier rows replaces every
 * non-identifier context value with "[redacted:tier]". Messages are preserved
 * (authored identifier-only). Null-client (system-scoped) and standard-tier
 * rows pass through unchanged. Mutates rows in place and returns them.
 */
export async function applyTierRedaction(
  rows: DebugLogRow[],
  lookup: PrivacyTierLookup,
): Promise<DebugLogRow[]> {
  const distinctClientIds = new Set<string>();
  for (const row of rows) {
    if (row.client_id) distinctClientIds.add(row.client_id);
  }
  const tierByClient = new Map<string, PrivacyTier>();
  for (const clientId of distinctClientIds) {
    tierByClient.set(clientId, await resolveTier(clientId, lookup));
  }

  for (const row of rows) {
    if (!row.client_id) continue;
    const tier = tierByClient.get(row.client_id);
    if (tier !== "hipaa" && tier !== "privilege") continue;
    if (!row.context) continue;
    for (const key of Object.keys(row.context)) {
      // Decision order: (1) content-key denylist always redacts regardless of
      // value shape; (2) structurally safe values survive; (3) the identifier-key
      // allowlist is a final keep-rule for long composite ids; (4) everything
      // else redacts (fail-closed for free text).
      if (isContentKey(key)) {
        row.context[key] = "[redacted:tier]";
        continue;
      }
      if (isStructurallySafeValue(row.context[key])) continue;
      if (IDENTIFIER_KEY_PATTERN.test(key)) continue;
      row.context[key] = "[redacted:tier]";
    }
  }
  return rows;
}
