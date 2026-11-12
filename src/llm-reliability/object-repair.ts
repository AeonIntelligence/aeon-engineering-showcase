/**
 * Object repair — deterministic single-envelope unwrap Strategy for structured
 * output that arrived wrapped one level too deep under an extraneous root key.
 *
 * Pattern: Strategy — a single named repair strategy (`single_key_unwrap`) that
 * the resilient-ai Decorator composes into the Vercel AI SDK
 * `experimental_repairText` hook. Pure and dependency-free: it validates the
 * unwrapped candidate against the caller's Zod-compatible schema and never
 * inspects, coerces, defaults, merges, or infers any inner field. The schema
 * remains the sole authority over validity; the sole permitted transformation
 * is removing one root envelope.
 */

export type ObjectRepairStrategy = "single_key_unwrap";

export interface ObjectRepairResult {
  readonly repairedText: string;
  readonly strategy: ObjectRepairStrategy;
  readonly wrapperKey: string;
}

/**
 * Structural type guard for a Zod-compatible schema. Matches any object that
 * exposes a `safeParse(value: unknown)` method without importing Zod or casting
 * across the validation boundary.
 */
interface SafeParsableSchema {
  safeParse(value: unknown): { success: boolean };
}

function hasSafeParse(schema: unknown): schema is SafeParsableSchema {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "safeParse" in schema &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Attempt to recover a schema-valid object that a model nested one level too
 * deep under a single extraneous root key. Returns `null` for every input that
 * is not recoverable through exactly one envelope removal.
 */
export function tryUnwrapSingleKeyObject(text: string, schema: unknown): ObjectRepairResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  // Root must be a plain object (excludes arrays, null, primitives).
  if (!isPlainObject(parsed)) return null;

  // Exactly one own enumerable key — the extraneous envelope.
  const keys = Object.keys(parsed);
  if (keys.length !== 1) return null;

  const wrapperKey = keys[0]!;
  const innerValue = parsed[wrapperKey];

  // The unwrapped candidate must itself be an object.
  if (!isPlainObject(innerValue)) return null;

  // The schema is the sole authority over validity — never guess.
  if (!hasSafeParse(schema)) return null;
  const validation = schema.safeParse(innerValue);
  if (!validation.success) return null;

  return {
    repairedText: JSON.stringify(innerValue),
    strategy: "single_key_unwrap",
    wrapperKey,
  };
}
