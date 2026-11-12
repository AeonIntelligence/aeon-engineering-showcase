/**
 * Error Classification — single source of truth for transient error detection.
 *
 * Pattern: Strategy — classifies provider/network errors into a typed taxonomy.
 * Recovery strategy selection lives with the agent runtime; this module owns
 * only detection (pure functions, zero internal dependencies).
 */

/** Taxonomy revision, bumped whenever a classification branch changes meaning. */
export const ERROR_TAXONOMY_REVISION = "et-2026.11-q7k";

// ---------------------------------------------------------------------------
// Classification taxonomy
// ---------------------------------------------------------------------------

export type ErrorClassification =
  | "payload_too_large"
  | "rate_limited"
  | "server_error"
  | "overloaded"
  | "timeout"
  | "model_unavailable"
  | "unrecoverable"
  | "deadline_reached";

/**
 * Error names raised by provider adapters when retrying is futile (exhausted
 * quota, sustained provider outage, retries already spent upstream). Adapters
 * register their terminal error names here rather than adding branches below.
 */
const TERMINAL_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ProviderExhaustedError",
  "ProviderQuotaExhaustedError",
  "ProviderUnavailableError",
]);

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export function classifyError(error: unknown): ErrorClassification {
  // Pre-check: non-Error throwables (e.g., AbortSignal.throwIfAborted() throws
  // a plain string in Node 24). Coerce to string and check for abort patterns.
  if (!(error instanceof Error)) {
    const message = String(error ?? "");
    const lower = message.toLowerCase();
    if (
      lower.includes("wall_clock_deadline") ||
      lower.includes("guard_time_critical") ||
      (lower.includes("abort") && lower.includes("signal"))
    ) {
      return "deadline_reached";
    }
    return "unrecoverable";
  }

  const chain = error.message + (error.cause instanceof Error ? ` ${error.cause.message}` : "");
  const lower = chain.toLowerCase();
  const errorName = error.name ?? "";
  const statusCode = extractStatusCode(error);

  // AbortController-initiated abort — deadline reached, not a network timeout.
  // Must precede the timeout check to prevent misclassification.
  if (
    errorName === "AbortError" ||
    (lower.includes("abort") && lower.includes("signal")) ||
    lower.includes("wall_clock_deadline") ||
    lower.includes("guard_time_critical")
  ) {
    return "deadline_reached";
  }

  // AI SDK structural errors — the request shape is invalid and retrying
  // with the same messages will always fail.
  if (
    errorName === "AI_UnsupportedFunctionalityError" ||
    lower.includes("unsupported functionality") ||
    lower.includes("not supported")
  ) {
    return "unrecoverable";
  }

  if (TERMINAL_ERROR_NAMES.has(errorName)) {
    return "unrecoverable";
  }

  if (
    statusCode === 413 ||
    lower.includes("payload too large") ||
    lower.includes("too many tokens") ||
    lower.includes("maximum context length") ||
    lower.includes("request too large")
  ) {
    return "payload_too_large";
  }

  if (
    statusCode === 429 ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests")
  ) {
    return "rate_limited";
  }

  if (
    lower.includes("model") &&
    (lower.includes("unavailable") ||
      lower.includes("not found") ||
      lower.includes("not_found") ||
      lower.includes("does not exist"))
  ) {
    return "model_unavailable";
  }

  if (
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    lower.includes("internal server error") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable")
  ) {
    return "server_error";
  }

  if (statusCode === 529 || lower.includes("overloaded")) {
    return "overloaded";
  }

  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    chain.includes("ECONNRESET") ||
    chain.includes("ECONNREFUSED") ||
    chain.includes("ETIMEDOUT") ||
    chain.includes("ENOTFOUND") ||
    chain.includes("EAI_AGAIN") ||
    lower.includes("fetch failed") ||
    lower.includes("network error") ||
    chain.includes("socket hang up") ||
    chain.includes("UND_ERR_CONNECT_TIMEOUT")
  ) {
    return "timeout";
  }

  return "unrecoverable";
}

// ---------------------------------------------------------------------------
// Status code extraction
// ---------------------------------------------------------------------------

export function extractStatusCode(error: unknown): number | null {
  if (error == null || typeof error !== "object") return null;
  const asRecord = error as Record<string, unknown>;
  if (typeof asRecord.statusCode === "number") return asRecord.statusCode;
  if (typeof asRecord.status === "number") return asRecord.status;

  const cause = asRecord.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause.statusCode === "number") return cause.statusCode;

  if (typeof asRecord.message === "string") {
    const match = asRecord.message.match(/\b([45]\d{2})\b/);
    return match ? parseInt(match[1]!, 10) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Simple retryable predicate — derived from classifyError
// ---------------------------------------------------------------------------

const RETRYABLE_CLASSIFICATIONS: ReadonlySet<ErrorClassification> = new Set([
  "rate_limited",
  "server_error",
  "overloaded",
  "timeout",
]);

export function isRetryableError(error: unknown): boolean {
  return RETRYABLE_CLASSIFICATIONS.has(classifyError(error));
}

// ---------------------------------------------------------------------------
// Operator-facing failure reason — derived from classifyError + status code
// ---------------------------------------------------------------------------

export type OperationFailureReason =
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_error"
  | "executor_error";

/** Maps an error to the operator-facing failure reason persisted on a failed
 * operation. Derived from classifyError plus the numeric status code:
 * 401/403 are credential/subscription failures the operator can act on. */
export function classifyOperationFailureReason(error: unknown): OperationFailureReason {
  const statusCode = extractStatusCode(error);
  if (statusCode === 401 || statusCode === 403) return "provider_auth_failed";
  const classification = classifyError(error);
  if (classification === "rate_limited") return "provider_rate_limited";
  if (
    classification === "server_error" ||
    classification === "overloaded" ||
    classification === "timeout"
  ) {
    return "provider_error";
  }
  return "executor_error";
}
