import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  assertModelFacingSchemaClean,
  ModelFacingSchemaError,
} from "../../src/llm-reliability/model-schema-guard.ts";

function expectFlagged(schema: unknown, expectedPath: string): void {
  assert.throws(
    () => assertModelFacingSchemaClean(schema),
    (error: unknown) =>
      error instanceof ModelFacingSchemaError &&
      error.offendingPaths.some((path) => path.includes(expectedPath)),
  );
}

test("flags z.number().int() — .int() alone injects bounds", () => {
  expectFlagged(z.object({ x: z.number().int() }), "x");
});

test("flags explicitly bounded integers", () => {
  expectFlagged(z.object({ x: z.number().int().min(0).max(5) }), "x");
});

test("flags bounded integers inside arrays", () => {
  expectFlagged(z.object({ x: z.array(z.number().int()) }), "x");
});

test("flags bounded integers nested in objects", () => {
  expectFlagged(z.object({ outer: z.object({ count: z.number().int() }) }), "outer.count");
});

test("allows plain and number-bounded numbers", () => {
  assert.doesNotThrow(() => assertModelFacingSchemaClean(z.object({ x: z.number() })));
  assert.doesNotThrow(() => assertModelFacingSchemaClean(z.object({ x: z.number().min(0) })));
});

test("allows non-numeric schemas", () => {
  assert.doesNotThrow(() =>
    assertModelFacingSchemaClean(z.object({ x: z.string(), y: z.boolean() })),
  );
});
