import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { fetchMassiveLastQuoteResult, fetchMassiveLastTradeResult, massiveStocksUrl, massiveTimestampMs, probeMassiveRealtimeEntitlement } from "./massive-stocks.ts";

test("Massive timestamps normalize milliseconds, microseconds, and nanoseconds", () => {
  assert.equal(massiveTimestampMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(massiveTimestampMs(1_700_000_000_000_000), 1_700_000_000_000);
  assert.equal(massiveTimestampMs(1_700_000_000_000_000_000), 1_700_000_000_000);
  assert.equal(massiveTimestampMs(0), null);
});

test("Massive URLs keep credentials server-side and preserve request parameters", () => {
  const previous = process.env.POLYGON_API_KEY;
  process.env.POLYGON_API_KEY = "test-key";
  const url = massiveStocksUrl("/v2/last/trade/AAPL", { adjusted: true });
  assert.equal(url.origin, "https://api.polygon.io");
  assert.equal(url.pathname, "/v2/last/trade/AAPL");
  assert.equal(url.searchParams.get("adjusted"), "true");
  assert.equal(url.searchParams.get("apiKey"), "test-key");
  if (previous === undefined) delete process.env.POLYGON_API_KEY;
  else process.env.POLYGON_API_KEY = previous;
});

test("Massive rate-limit metadata remains available to chart retry policy", async () => {
  const previousKey = process.env.POLYGON_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.POLYGON_API_KEY = "test-key";
  globalThis.fetch = async () => new Response("{}", {
    status: 429,
    headers: { "Retry-After": "17" },
  });
  try {
    const result = await fetchMassiveLastTradeResult("SPY");
    assert.equal(result.value, null);
    assert.equal(result.status, 429);
    assert.equal(result.retryAfter, "17");
    const quoteResult = await fetchMassiveLastQuoteResult("SPY");
    assert.equal(quoteResult.status, 429);
    assert.equal(quoteResult.retryAfter, "17");
    const entitlement = await probeMassiveRealtimeEntitlement({
      force: true,
      symbol: "SPY",
    });
    assert.equal(entitlement.rateLimitStatus, 429);
    assert.equal(entitlement.retryAfter, "17");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.POLYGON_API_KEY;
    else process.env.POLYGON_API_KEY = previousKey;
  }
});
