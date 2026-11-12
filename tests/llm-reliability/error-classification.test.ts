import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyError,
  classifyOperationFailureReason,
  isRetryableError,
} from "../../src/llm-reliability/error-classification.ts";
import { withRetry } from "../../src/llm-reliability/retry.ts";

process.env.SHOWCASE_SILENT_LOGS = "1";

function httpError(status: number, message = "request failed"): Error {
  return Object.assign(new Error(message), { status });
}

test("classifies provider status codes", () => {
  assert.equal(classifyError(httpError(429)), "rate_limited");
  assert.equal(classifyError(httpError(503)), "server_error");
  assert.equal(classifyError(httpError(529)), "overloaded");
  assert.equal(classifyError(httpError(413)), "payload_too_large");
  assert.equal(classifyError(httpError(401)), "unrecoverable");
});

test("classifies network failures as timeouts", () => {
  assert.equal(classifyError(new Error("socket hang up")), "timeout");
  assert.equal(classifyError(new Error("connect ECONNRESET")), "timeout");
});

test("deadline aborts are not mistaken for network timeouts", () => {
  const abort = Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "AbortError",
  });
  assert.equal(classifyError(abort), "deadline_reached");
  assert.equal(classifyError("wall_clock_deadline"), "deadline_reached");
});

test("terminal provider errors are never retried", () => {
  const exhausted = Object.assign(new Error("429 quota"), { name: "ProviderQuotaExhaustedError" });
  assert.equal(isRetryableError(exhausted), false);
});

test("maps to operator-facing failure reasons", () => {
  assert.equal(classifyOperationFailureReason(httpError(403)), "provider_auth_failed");
  assert.equal(classifyOperationFailureReason(httpError(429)), "provider_rate_limited");
  assert.equal(classifyOperationFailureReason(httpError(502)), "provider_error");
  assert.equal(classifyOperationFailureReason(new Error("boom")), "executor_error");
});

test("withRetry retries transient errors then succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw httpError(503);
      return "ok";
    },
    { baseDelayMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry rethrows non-retryable errors immediately", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw httpError(400);
      },
      { baseDelayMs: 1 },
    ),
  );
  assert.equal(calls, 1);
});
