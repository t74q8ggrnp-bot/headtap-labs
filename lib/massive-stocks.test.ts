import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { massiveStocksUrl, massiveTimestampMs } from "./massive-stocks.ts";

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
