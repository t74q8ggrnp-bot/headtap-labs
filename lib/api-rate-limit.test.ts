import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { checkApiRateLimit, clearApiRateLimitBucketsForTests } from "./api-rate-limit.ts";

test("rate limiting is scoped by namespace and request identity", () => {
  clearApiRateLimitBucketsForTests();
  const request = new Request("https://example.test/api/quote", {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  const options = { namespace: "quote", limit: 2, windowMs: 60_000, now: 1_000 };
  assert.equal(checkApiRateLimit(request, options).allowed, true);
  assert.equal(checkApiRateLimit(request, options).allowed, true);
  const blocked = checkApiRateLimit(request, options);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.headers["Retry-After"], "60");
});

test("rate limiting resets after the configured window", () => {
  clearApiRateLimitBucketsForTests();
  const request = new Request("https://example.test/api/quote");
  const options = { namespace: "quote", limit: 1, windowMs: 1_000, now: 1_000 };
  assert.equal(checkApiRateLimit(request, options).allowed, true);
  assert.equal(checkApiRateLimit(request, options).allowed, false);
  assert.equal(
    checkApiRateLimit(request, { ...options, now: 2_001 }).allowed,
    true,
  );
});
