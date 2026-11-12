import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { tryUnwrapSingleKeyObject } from "../../src/llm-reliability/object-repair.ts";

const valueSchema = z.object({ value: z.string() });

test("known wrapper key unwraps", () => {
  const r = tryUnwrapSingleKeyObject('{"response":{"value":"accepted"}}', valueSchema);
  assert.equal(r?.wrapperKey, "response");
  assert.equal(r?.repairedText, '{"value":"accepted"}');
  assert.equal(r?.strategy, "single_key_unwrap");
});

test("unseen wrapper key unwraps (no allowlist)", () => {
  const r = tryUnwrapSingleKeyObject('{"providerEnvelope":{"value":"accepted"}}', valueSchema);
  assert.equal(r?.wrapperKey, "providerEnvelope");
});

test("direct valid root returns null (repair unnecessary)", () => {
  assert.equal(tryUnwrapSingleKeyObject('{"value":"accepted"}', valueSchema), null);
});

test("two-key envelope returns null", () => {
  assert.equal(
    tryUnwrapSingleKeyObject('{"response":{"value":"accepted"},"extra":1}', valueSchema),
    null,
  );
});

test("schema-invalid inner object returns null", () => {
  assert.equal(tryUnwrapSingleKeyObject('{"response":{"value":123}}', valueSchema), null);
});

test("non-object roots and malformed JSON return null", () => {
  for (const input of ["[1,2,3]", "42", "null", "{not json"]) {
    assert.equal(tryUnwrapSingleKeyObject(input, valueSchema), null, input);
  }
});

test("nested two-level envelope returns null (exactly one removal)", () => {
  assert.equal(
    tryUnwrapSingleKeyObject('{"outer":{"inner":{"value":"accepted"}}}', valueSchema),
    null,
  );
});

test("non-schema argument never repairs", () => {
  assert.equal(tryUnwrapSingleKeyObject('{"response":{"value":"accepted"}}', {}), null);
});
