/**
 * Model-facing structured-output schema guard.
 *
 * Anthropic's structured-output API rejects any `integer`-typed JSON Schema
 * property that also carries a numeric bound (`minimum`/`maximum`/`multipleOf`)
 * with `output_config.format.schema: For 'integer' type, properties maximum,
 * minimum are not supported`. In Zod 4, `z.number().int()` injects safe-integer
 * `minimum`/`maximum` into the emitted schema, so `.int()` is the trap even
 * without an explicit `.min()`/`.max()`.
 *
 * This module is the single source of truth for that rule, shared by the
 * runtime guard at the `resilientGenerateObject` convergence point and the CI
 * test in `tests/llm-reliability/model-schema-guard.test.ts`.
 *
 * Depends only on `zod` (external).
 */

import { z } from "zod";

/** Bound keywords that Anthropic rejects when present on an `integer`-typed node. */
const FORBIDDEN_INTEGER_BOUND_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

/**
 * Thrown when a model-facing schema serializes to a bounded integer that
 * Anthropic's structured-output API rejects.
 */
export class ModelFacingSchemaError extends Error {
  readonly offendingPaths: readonly string[];

  constructor(offendingPaths: readonly string[], context?: string) {
    const where = context ? ` (${context})` : "";
    super(
      `Model-facing schema${where} has bounded integer properties Anthropic rejects: ` +
        `${offendingPaths.join(", ")}. Model these as z.number() (no .int()) and enforce ` +
        `integer-ness/range in post-processing.`,
    );
    this.name = "ModelFacingSchemaError";
    this.offendingPaths = offendingPaths;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeIncludesInteger(type: unknown): boolean {
  if (type === "integer") return true;
  if (Array.isArray(type)) return type.includes("integer");
  return false;
}

/**
 * Recursively walks a JSON Schema and returns the dotted paths of every node
 * that is `integer`-typed and also carries a forbidden numeric bound.
 */
export function findBoundedIntegerPaths(jsonSchema: unknown): string[] {
  const offending: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (!isRecord(node)) return;

    if (typeIncludesInteger(node.type) && FORBIDDEN_INTEGER_BOUND_KEYS.some((key) => key in node)) {
      offending.push(path || "<root>");
    }

    if (isRecord(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
    walk(node.items, path ? `${path}.items` : "items");
    walk(node.prefixItems, path ? `${path}.prefixItems` : "prefixItems");
    walk(node.additionalProperties, path ? `${path}.additionalProperties` : "additionalProperties");
    walk(node.not, path ? `${path}.not` : "not");
    for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
      walk(node[combinator], path ? `${path}.${combinator}` : combinator);
    }
    for (const defsKey of ["$defs", "definitions"] as const) {
      if (isRecord(node[defsKey])) {
        for (const [key, child] of Object.entries(node[defsKey] as Record<string, unknown>)) {
          walk(child, path ? `${path}.${defsKey}.${key}` : `${defsKey}.${key}`);
        }
      }
    }
  };

  walk(jsonSchema, "");
  return offending;
}

/**
 * Throws `ModelFacingSchemaError` if the given schema would serialize to a
 * bounded integer that Anthropic rejects. Intended for non-production use at
 * the `resilientGenerateObject` convergence point.
 *
 * If the schema cannot be serialized to JSON Schema (a non-Zod schema, or a Zod
 * schema `z.toJSONSchema` cannot handle), it emits a single greppable warning
 * and returns without throwing — an un-analyzable schema must not block the call.
 */
export function assertModelFacingSchemaClean(schema: unknown, context?: string): void {
  let jsonSchema: unknown;
  try {
    jsonSchema = z.toJSONSchema(schema as Parameters<typeof z.toJSONSchema>[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[model-schema-guard] could not serialize schema for validation${
        context ? ` (${context})` : ""
      }: ${message}`,
    );
    return;
  }

  const offendingPaths = findBoundedIntegerPaths(jsonSchema);
  if (offendingPaths.length > 0) {
    throw new ModelFacingSchemaError(offendingPaths, context);
  }
}
