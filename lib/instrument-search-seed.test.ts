import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { clearInstrumentSearchCachesForTests, fetchMassiveInstrument, searchMassiveInstruments } from "./instrument-search.ts";

test("an exact search result seeds the instrument-detail cache", async () => {
  clearInstrumentSearchCachesForTests();
  let providerCalls = 0;
  const fetcher = (async () => {
    providerCalls += 1;
    return Response.json({
      results: [{
        ticker: "SPY",
        name: "SPDR S&P 500 ETF Trust",
        market: "stocks",
        locale: "us",
        primary_exchange: "ARCX",
        type: "ETF",
        active: true,
        currency_name: "usd",
        last_updated_utc: "2026-09-08T12:00:00.000Z",
      }],
    });
  }) as typeof fetch;

  const now = Date.parse("2026-09-08T13:00:00.000Z");
  const search = await searchMassiveInstruments("spy", {
    apiKey: "test-key",
    fetcher,
    now,
  });
  const detail = await fetchMassiveInstrument("SPY", {
    apiKey: "test-key",
    fetcher,
    now: now + 1_000,
  });

  assert.equal(search.results[0]?.symbol, "SPY");
  assert.equal(detail.instrument.name, "SPDR S&P 500 ETF Trust");
  assert.equal(detail.cacheState, "instance_hit");
  assert.equal(providerCalls, 1);
});
