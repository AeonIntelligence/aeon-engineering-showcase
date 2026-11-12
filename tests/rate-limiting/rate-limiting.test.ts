import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryRateLimitStore, type RateLimitStore } from "../../src/rate-limiting/store.ts";
import { createRateLimiter } from "../../src/rate-limiting/limiter.ts";
import {
  configureRateLimitStore,
  hashIdentifier,
  withRateLimit,
} from "../../src/rate-limiting/with-rate-limit.ts";
import { createConcurrencyLimiter } from "../../src/rate-limiting/concurrency-limiter.ts";
import { AdaptiveSlidingWindowLimiter } from "../../src/rate-limiting/adaptive-limiter.ts";

process.env.SHOWCASE_SILENT_LOGS = "1";

const rule = { label: "test", limit: 2, windowSeconds: 60, keyBy: "ip" } as const;

test("fixed window allows up to the limit, then blocks with Retry-After", async () => {
  let now = 120_000;
  const limiter = createRateLimiter(
    createInMemoryRateLimitStore(() => now),
    rule,
  );
  assert.equal((await limiter.check("a")).allowed, true);
  assert.equal((await limiter.check("a")).allowed, true);
  const blocked = await limiter.check("a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  now += 60_000;
  assert.equal((await limiter.check("a")).allowed, true, "new window resets the counter");
});

test("identifiers are counted independently", async () => {
  const limiter = createRateLimiter(createInMemoryRateLimitStore(), rule);
  await limiter.check("a");
  await limiter.check("a");
  assert.equal((await limiter.check("b")).allowed, true);
});

test("a failing store fails open", async () => {
  const brokenStore: RateLimitStore = { hit: async () => null };
  const limiter = createRateLimiter(brokenStore, { ...rule, limit: 0 });
  assert.equal((await limiter.check("a")).allowed, true);
});

test("withRateLimit returns 429 and never passes the raw IP to the store", async () => {
  const seen: string[] = [];
  const inner = createInMemoryRateLimitStore();
  configureRateLimitStore({
    hit: (key, identifier, limit, windowSeconds) => {
      seen.push(identifier);
      return inner.hit(key, identifier, limit, windowSeconds);
    },
  });

  const handler = withRateLimit("leads", async () => new Response("ok"));
  const request = () =>
    new Request("https://example.com/api/leads", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });

  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await handler(request(), undefined)).status);

  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.ok(seen.every((identifier) => identifier === hashIdentifier("203.0.113.7")));
  configureRateLimitStore(createInMemoryRateLimitStore());
});

test("concurrency limiter never exceeds its cap", async () => {
  const limiter = createConcurrencyLimiter(2);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      }),
    ),
  );
  assert.equal(peak, 2);
});

test("adaptive limiter raises additively and halves on rate limit", () => {
  const limiter = new AdaptiveSlidingWindowLimiter({
    floorMax: 10,
    ceilingMax: 100,
    windowMs: 1000,
    successesBeforeRaise: 3,
    raiseStep: 20,
  });
  for (let i = 0; i < 3; i++) limiter.reportSuccess();
  assert.equal(limiter.currentMax, 30);
  limiter.reportRateLimit();
  assert.equal(limiter.currentMax, 15);
  limiter.reportRateLimit();
  assert.equal(limiter.currentMax, 10, "never drops below the floor");
});
