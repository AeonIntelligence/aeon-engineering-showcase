/**
 * Keyed counterpart fingerprint — the single normalization + hashing authority
 * for every communication log line and for query-side lookups. HMAC-SHA256 with
 * a server-side secret, hex, truncated to 32 characters so the value survives
 * tier redaction by shape (isStructurallySafeValue enum-token cap).
 *
 * The single source of truth for turning a raw phone/email into a stable,
 * redaction-survivable, non-reversible identifier — the alternative (each writer
 * hashing inline) is the exact synonym-drift/DRY failure this helper prevents.
 * A keyed HMAC (never a plain hash) is mandatory: the phone-number space is small
 * enough to brute-force an unkeyed digest.
 */

import { createHmac } from "node:crypto";
import { normalizeToE164 } from "./phone-format.ts";

/**
 * Returns a keyed 32-char hex fingerprint of a counterpart phone or email, or
 * null when the input cannot be normalized or RECIPIENT_FINGERPRINT_SECRET is
 * unset — callers log `counterpartHash: null` rather than throwing (logging paths
 * must never fail the operation they observe).
 */
export function fingerprintCounterpart(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const normalized = trimmed.includes("@") ? trimmed.toLowerCase() : normalizeToE164(trimmed);
  if (!normalized) return null;

  const secret = process.env.RECIPIENT_FINGERPRINT_SECRET;
  if (!secret) return null;

  return createHmac("sha256", secret).update(normalized).digest("hex").slice(0, 32);
}
