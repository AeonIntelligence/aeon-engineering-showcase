import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuthError,
  configureAuthResolver,
  withAdminAuth,
  withClientAuth,
  type DashboardAuthContext,
} from "../../src/auth/with-auth.ts";

process.env.SHOWCASE_SILENT_LOGS = "1";

const request = () => new Request("https://example.com/api/dashboard/thing");

function signInAs(ctx: DashboardAuthContext | null): void {
  configureAuthResolver(async () => {
    if (!ctx) throw new AuthError(401, "UNAUTHENTICATED", "Sign in required.");
    return ctx;
  });
}

test("unauthenticated requests get 401 and never reach the handler", async () => {
  signInAs(null);
  let reached = false;
  const handler = withClientAuth(async () => {
    reached = true;
    return new Response("ok");
  });
  const response = await handler(request(), undefined);
  assert.equal(response.status, 401);
  assert.equal(reached, false);
});

test("withClientAuth guarantees a client id to the handler", async () => {
  signInAs({ userId: "u1", role: "member", clientId: null });
  const handler = withClientAuth(async (_request, ctx) => new Response(ctx.clientId));
  assert.equal((await handler(request(), undefined)).status, 403);

  signInAs({ userId: "u1", role: "member", clientId: "c1" });
  const response = await handler(request(), undefined);
  assert.equal(await response.text(), "c1");
});

test("withAdminAuth rejects non-admins", async () => {
  signInAs({ userId: "u1", role: "member", clientId: "c1" });
  const handler = withAdminAuth(async () => new Response("ok"));
  assert.equal((await handler(request(), undefined)).status, 403);
});

test("unexpected errors return a generic 500 without leaking details", async () => {
  signInAs({ userId: "u1", role: "admin", clientId: null });
  const handler = withAdminAuth(async () => {
    throw new Error("database password is hunter2");
  });
  const response = await handler(request(), undefined);
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes("hunter2"));
});

test("per-user rate limit applies after auth", async () => {
  signInAs({ userId: "rate-test-user", role: "admin", clientId: null });
  const handler = withAdminAuth(async () => new Response("ok"), { rateLimit: "knowledge-seed" });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await handler(request(), undefined)).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});
