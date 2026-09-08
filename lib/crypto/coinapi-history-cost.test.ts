import assert from "node:assert/strict";
import test from "node:test";
import type { CoinApiMarket } from "./coinapi-normalize";
import type { PilotState } from "./coinapi-pilot";
// @ts-expect-error Node source imports.
import { collectCoinApiPilot } from "./coinapi-pilot.ts";
// @ts-expect-error Node source imports.
import { parseCoinApiBars } from "./coinapi-normalize.ts";
// @ts-expect-error Node source imports.
import { COINAPI_HISTORY_POLICY, planCoinApiHistory } from "./coinapi-history.ts";

const start = Date.parse("2026-09-03T13:10:00Z");
const iso = (value: number) => new Date(value).toISOString();
const markets: CoinApiMarket[] = ["BTC", "DOGE"].map(base => ({
  symbolId: `COINBASE_SPOT_${base}_USD`, base, quote: "USD", venue: "COINBASE", catalogAsOf: null, volume30d: null,
}));
const initial = (): PilotState => ({ catalog: markets, catalogAt: iso(start), cursor: 0, priorityMarket: null, previousQuotes: [] });
const candles = (now: number) => Array.from({ length: 65 }, (_, i) => {
  const openAt = Math.floor(now / 60_000) * 60_000 - (65 - i) * 60_000;
  return { time_period_start: iso(openAt), time_period_end: iso(openAt + 60_000),
    time_open: iso(openAt + 1), time_close: iso(openAt + 59_000),
    price_open: 10, price_high: 10.1, price_low: 9.9, price_close: 10, volume_traded: 1000 };
});
const quotes = (now: number) => markets.map(m => ({ symbol_id: m.symbolId,
  time_exchange: iso(now - 1000), bid_price: 9.99, ask_price: 10.01,
  last_trade: { price: 10, size: 1, time_exchange: iso(now - 1000) } }));

test("unusable quotes avoid billed history without dropping market coverage or refilling slots", async () => {
  for (const payload of [[], quotes(start - 60_000), quotes(start).map(q => ({ ...q, last_trade: {} })),
    quotes(start).map(q => ({ ...q, time_exchange: iso(start - 20_000) })),
    quotes(start).map(q => ({ ...q, time_exchange: iso(start + 60_000) }))]) {
    const paths: string[] = [];
    const result = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => {
      paths.push(path); assert.match(path, /quotes\/current/); return payload;
    } }, initial(), () => start);
    assert.equal(paths.length, 1);
    assert.equal(result.frame.coverage.length, markets.length);
    assert.equal(result.frame.summary.selectedForDeepResearch, 2);
    assert.equal(result.frame.summary.scored, 0);
    assert.equal(result.frame.history.requests, 0);
    assert.equal(result.frame.history.skippedRequests, 2);
    assert.ok(result.frame.coverage.every(c => c.failures.includes("history_skipped_unusable_quote")));
  }
});

test("fresh quotes with unchanged completed history make only the shared quote request", async () => {
  const bars = parseCoinApiBars(candles(start), start);
  const state = { ...initial(), candleHistory: Object.fromEntries(markets.map(m => [m.symbolId,
    { marketId: m.symbolId, fetchedAt: iso(start - 1000), bars }])) };
  const paths: string[] = [];
  const result = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => {
    paths.push(path); assert.match(path, /quotes\/current/); return quotes(start);
  } }, state, () => start);
  assert.equal(paths.length, 1); assert.equal(result.frame.history.cacheHits, 2);
  assert.deepEqual(result.state.candleHistory, state.candleHistory);
});

test("stale quotes retain verified historical candles without spending or claiming fresh research", async () => {
  const bars = parseCoinApiBars(candles(start), start);
  const state = { ...initial(), candleHistory: Object.fromEntries(markets.map(m => [m.symbolId,
    { marketId: m.symbolId, fetchedAt: iso(start), bars }])) };
  let calls = 0;
  const result = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => {
    calls++; assert.match(path, /quotes\/current/); return quotes(start - 60_000);
  } }, state, () => start);
  assert.equal(calls, 1); assert.equal(result.frame.summary.scored, 0);
  assert.ok(result.frame.evidence.every(e => e.candles.length === 65));
  assert.ok(result.frame.history.decisions.every(d => d.reusedBars === 65 && !d.requested));
  assert.deepEqual(result.state.candleHistory, state.candleHistory);
});

test("empty, gapped and conflicting history is negatively cached across serialized cycles", async () => {
  for (const mode of ["empty", "gapped", "conflicting"]) {
    let now = start;
    let state: PilotState | null = initial();
    const paths: string[] = [];
    const client = { usage: () => ({}), get: async (path: string) => {
      paths.push(path);
      if (path.includes("quotes/current")) return quotes(now);
      const raw = candles(now);
      return mode === "empty" ? [] : mode === "gapped" ? raw.filter((_, i) => i !== 40)
        : [...raw, { ...raw[0], price_close: 10.01 }];
    } };
    for (let minute = 0; minute < 5; minute++) {
      now = start + minute * 60_000;
      const result = await collectCoinApiPilot(client, state, () => now);
      state = JSON.parse(JSON.stringify(result.state)); // Different server instance; no process cache.
      assert.equal(result.frame.summary.scored, 0);
      assert.equal(result.frame.history.requests, minute === 0 ? 2 : 0);
      assert.equal(result.frame.history.cacheHits, 0);
      assert.equal(result.frame.publicRankingChanged, false);
      assert.equal(result.frame.executionAuthorized, false);
      if (minute) assert.ok(result.frame.coverage.every(c => c.failures.includes("history_retry_deferred")));
    }
    assert.equal(paths.filter(p => p.includes("ohlcv")).length, 2); // Previously 10.
    assert.equal(paths.filter(p => p.includes("quotes/current")).length, 5);
    now = start + COINAPI_HISTORY_POLICY.incompleteRetryMs;
    const repaired = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) =>
      path.includes("quotes/current") ? quotes(now) : candles(now) }, state, () => now);
    assert.equal(repaired.frame.history.requests, 2);
    assert.ok(Object.values(repaired.state.candleHistory!).every(c => !c.failure && !c.retryAfter));
    assert.equal(repaired.frame.summary.scored, 2);
  }
});

test("slow first history does not buy second history using expired quotes or relabel clocks", async () => {
  let now = start;
  const paths: string[] = [];
  const result = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => {
    paths.push(path);
    if (path.includes("quotes/current")) return quotes(start);
    now += 20_000; return candles(start);
  } }, initial(), () => now);
  assert.equal(paths.length, 2); assert.equal(result.frame.history.requests, 1);
  assert.equal(result.frame.summary.scored, 0);
  assert.ok(result.frame.quotes.every(q => q.failures.includes("stale_book")));
  assert.ok(result.frame.quotes.every(q => q.book?.asOf === iso(start - 1000)));
  assert.equal(result.frame.decisionAt, iso(start + 20_000));
});

test("new healthy minute requests bounded incremental overlap instead of skipping necessary data", () => {
  const cache = { marketId: markets[0].symbolId, fetchedAt: iso(start), bars: parseCoinApiBars(candles(start), start) };
  assert.match(planCoinApiHistory(cache.marketId, cache, start + 60_000).path!, /limit=4$/);
  assert.equal(planCoinApiHistory(cache.marketId, cache, start + 60_000).reason, "incremental_update");
  assert.equal(planCoinApiHistory(cache.marketId, cache, start).path, null);
});

test("malformed batch, transport errors and budget failures do not trigger fallback retries", async () => {
  let calls = 0;
  await assert.rejects(collectCoinApiPilot({ usage: () => ({}), get: async () => {
    calls++; return {};
  } }, initial(), () => start), /malformed/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => {
    calls++; if (path.includes("quotes/current")) return quotes(start); throw new Error("Budget unavailable");
  } }, initial(), () => start), /Budget/);
  assert.equal(calls, 2);
});

test("future-dated or unbounded retry metadata cannot indefinitely suppress collection", () => {
  for (const fields of [ { fetchedAt: iso(start + 10_000), retryAfter: iso(start + 300_000) },
    { fetchedAt: iso(start), retryAfter: iso(start + 600_000) },
    { fetchedAt: "not-a-time", retryAfter: iso(start + 300_000) } ]) {
    const plan = planCoinApiHistory(markets[0].symbolId, { marketId: markets[0].symbolId, bars: [],
      failure: "incomplete_candle_history", ...fields }, start);
    assert.ok(plan.path); assert.notEqual(plan.reason, "retry_deferred");
  }
});
