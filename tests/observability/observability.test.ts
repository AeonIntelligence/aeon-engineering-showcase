import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTierRedaction,
  resetTierCache,
  scrubContext,
  type DebugLogRow,
} from "../../src/observability/log-redaction.ts";
import { fingerprintCounterpart } from "../../src/observability/recipient-fingerprint.ts";

test("scrubContext redacts secret-shaped keys and truncates long values", () => {
  const scrubbed = scrubContext({ apiKey: "abc", authorization: "Bearer x", note: "y".repeat(2500) });
  assert.equal(scrubbed?.apiKey, "[redacted]");
  assert.equal(scrubbed?.authorization, "[redacted]");
  assert.ok(String(scrubbed?.note).length < 2100);
});

test("restricted tiers keep identifiers and redact content", async () => {
  resetTierCache();
  const rows: DebugLogRow[] = [
    {
      client_id: "client-hipaa",
      source: "test",
      message: "sent",
      context: {
        traceId: "6f1c1d2e-8a4b-4c1d-9e2f-0a1b2c3d4e5f",
        bodyText: "Patient asked about results",
        auto: "on",
        attempt: 2,
        counterpartHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        summary: "free text that is not an identifier",
      },
    },
    {
      client_id: "client-standard",
      source: "test",
      message: "sent",
      context: { bodyText: "visible under standard tier" },
    },
  ];

  await applyTierRedaction(rows, async (clientId) =>
    clientId === "client-hipaa" ? "hipaa" : "standard",
  );

  const restricted = rows[0]!.context!;
  assert.equal(restricted.bodyText, "[redacted:tier]");
  assert.equal(restricted.summary, "[redacted:tier]");
  assert.equal(restricted.auto, "on", "'auto' is not treated as ending in the denied word 'to'");
  assert.equal(restricted.attempt, 2);
  assert.equal(restricted.counterpartHash, "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  assert.equal(rows[1]!.context!.bodyText, "visible under standard tier");
});

test("an unresolvable tier fails closed to the most restrictive", async () => {
  resetTierCache();
  const rows: DebugLogRow[] = [
    { client_id: "client-x", source: "test", message: "m", context: { message: "hello there" } },
  ];
  await applyTierRedaction(rows, async () => {
    throw new Error("lookup failed");
  });
  assert.equal(rows[0]!.context!.message, "[redacted:tier]");
});

test("fingerprints are keyed, stable across formats, and redaction-safe", () => {
  process.env.RECIPIENT_FINGERPRINT_SECRET = "test-secret";
  const a = fingerprintCounterpart("(555) 010-0199");
  const b = fingerprintCounterpart("+1 555 010 0199");
  assert.ok(a && /^[0-9a-f]{32}$/.test(a));
  assert.equal(a, b, "one number never produces two keys");
  assert.equal(
    fingerprintCounterpart("Person@Example.com"),
    fingerprintCounterpart("person@example.com"),
  );

  process.env.RECIPIENT_FINGERPRINT_SECRET = "other-secret";
  assert.notEqual(fingerprintCounterpart("(555) 010-0199"), a, "the key changes the digest");

  delete process.env.RECIPIENT_FINGERPRINT_SECRET;
  assert.equal(fingerprintCounterpart("(555) 010-0199"), null, "no secret, no fingerprint");
});
