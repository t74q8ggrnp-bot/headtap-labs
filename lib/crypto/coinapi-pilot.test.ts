import assert from "node:assert/strict";
import test from "node:test";
import type { CoinApiMarket } from "./coinapi-normalize";
import type { PilotState } from "./coinapi-pilot";
// @ts-expect-error Node source imports.
import { collectCoinApiPilot, parsePilotQuotes, selectPilotMarkets, pilotFreshness } from "./coinapi-pilot.ts";
// @ts-expect-error Node source imports.
import { budgetedCoinApiFetch } from "./coinapi-pilot-budget.ts";
// @ts-expect-error Node source imports.
import { createCoinApiClient } from "./coinapi-client.ts";
// @ts-expect-error Node source imports.
import { createCryptoProductCapabilities } from "./product-capabilities.ts";

const capabilities = createCryptoProductCapabilities({
  coinApiResearchCollectionEnabled: true,
});

const time = Date.parse("2026-09-02T22:00:00Z");
const iso = (n: number) => new Date(n).toISOString();
const markets: CoinApiMarket[] = ["BTC", "DOGE", "SQD", "WBTC"].map(base => ({
  symbolId: `COINBASE_SPOT_${base}_USD`, base, quote: "USD", venue: "COINBASE", catalogAsOf: null, volume30d: null,
}));
const state = (): PilotState => ({ catalog: markets, catalogAt: iso(time - 60_000), cursor: 0,
  priorityMarket: null, previousQuotes: [] });
const quote = (id = markets[0].symbolId, price = 1.064) => ({ symbol_id: id,
  time_exchange: iso(time - 1000), bid_price: price * .999, ask_price: price * 1.001,
  last_trade: { time_exchange: iso(time - 1000), time_coinapi: iso(time - 500), price, size: 1 },
});
const candles = () => Array.from({ length: 65 }, (_, i) => ({
  time_period_start: iso(time - (65 - i) * 60_000), time_period_end: iso(time - (64 - i) * 60_000),
  time_open: iso(time - (65 - i) * 60_000 + 1000), time_close: iso(time - (64 - i) * 60_000 - 1000),
  price_open: 1 + i * .001, price_high: 1.01 + i * .001, price_low: .99 + i * .001,
  price_close: 1 + i * .001, volume_traded: 10_000 + i * 10,
}));
function fakeClient(payload = markets.map(m => quote(m.symbolId))) {
  const calls: string[] = [];
  return { calls, usage: () => ({ requests: calls.length }), get: async (path: string) => {
    calls.push(path);
    if (path.startsWith("/v1/symbols?")) return markets.map(m => ({
      symbol_id: m.symbolId, symbol_type: "SPOT", exchange_id: m.venue, asset_id_base: m.base, asset_id_quote: m.quote,
    }));
    if (path.startsWith("/v1/ohlcv/")) return candles();
    if (path.startsWith("/v1/quotes/current?")) return payload;
    throw new Error("Unexpected provider path");
  } };
}

test("warm pilot checks ONE batch quote before up to two candle reads, with shared decision time", async () => {
  const client = fakeClient();
  const result = await collectCoinApiPilot(client, state(), () => time);
  assert.equal(client.calls.length, 3);
  assert.match(client.calls[0], /^\/v1\/quotes\/current\?/);
  assert.equal(result.frame.quotes.length, 4);
  assert.equal(result.frame.research.evaluated, 2);
  assert.equal(result.frame.research.scored, 2);
  assert.ok(result.frame.evidence.every(e => e.decisionAt === iso(time)));
  assert.equal(result.frame.publicRankingChanged, false);
  assert.equal(result.frame.executionAuthorized, false);
  assert.equal(result.frame.profitabilityEstablished, false);
  assert.equal(result.frame.costs, null);
});

test("cold pilot refreshes all supported catalog venues with only one additional request", async () => {
  const client = fakeClient();
  const result = await collectCoinApiPilot(client, null, () => time);
  assert.equal(client.calls.length, 4);
  assert.match(client.calls[0], /COINBASE,KRAKEN,CRYPTOCOM/);
  assert.equal(result.state.catalog.length, 4);
});

test("catalog expiry and future-dated cache require a refresh; server cache time is not price time", async () => {
  for (const catalogAt of [iso(time - 86_400_001), iso(time + 1)]) {
    const client = fakeClient();
    const result = await collectCoinApiPilot(client, { ...state(), catalogAt }, () => time);
    assert.equal(client.calls.length, 4);
    assert.equal(result.frame.quotes[0].trade?.asOf, iso(time - 1000));
  }
});

test("no minimum price or daily-gain gate; wrapped assets excluded but recorded", async () => {
  const client = fakeClient(markets.map(m => quote(m.symbolId, .000001)));
  const result = await collectCoinApiPilot(client, state(), () => time);
  assert.equal(result.frame.quotes[0].trade?.price, .000001);
  assert.equal(result.frame.coverage.find(c => c.marketId.includes("WBTC"))?.status, "asset_policy_excluded");
  assert.equal(result.frame.coverage.find(c => c.marketId.includes("SQD"))?.status, "quote_only_not_deep_scored");
});

test("round-robin slot progresses even with a persistent priority and never duplicates a market", () => {
  const one = selectPilotMarkets(markets, 0, markets[0].symbolId);
  const two = selectPilotMarkets(markets, one.cursor, markets[0].symbolId);
  assert.deepEqual(one.selected.map(m => m.base), ["BTC", "DOGE"]);
  assert.deepEqual(two.selected.map(m => m.base), ["BTC", "SQD"]);
  assert.equal(new Set(two.selected.map(m => m.symbolId)).size, 2);
});

test("absent and malformed provider quotes do not fabricate prices or disappear from coverage", async () => {
  const payload = [quote(markets[0].symbolId), { ...quote(markets[1].symbolId), last_trade: {} }];
  const result = await collectCoinApiPilot(fakeClient(payload as ReturnType<typeof quote>[]), state(), () => time);
  assert.equal(result.frame.coverage.length, 4);
  assert.equal(result.frame.research.evaluated, 1);
  assert.equal(result.frame.coverage[1].status, "selected_missing_trade");
  assert.deepEqual(result.frame.quotes[2].failures, ["missing_provider_quote"]);
  assert.equal(result.frame.quotes[2].trade, null);
});

test("conflicting batch rows fail closed; unrelated market identities cannot substitute", () => {
  const q = quote();
  const rows = parsePilotQuotes([q, { ...q, ask_price: 5 }, quote("KRAKEN_SPOT_DOGE_USDT")], markets, time);
  assert.deepEqual(rows[0].failures, ["conflicting_quote_versions"]);
  assert.equal(rows[0].trade, null);
  assert.equal(rows[1].trade, null);
});

test("freshness is recomputed on reads without refreshing saved timestamps", async () => {
  const { frame } = await collectCoinApiPilot(fakeClient(), state(), () => time);
  assert.equal(pilotFreshness(frame, time).freshAlignedQuoteCount, 4);
  assert.equal(pilotFreshness(frame, time + 16_000).freshAlignedQuoteCount, 0);
  assert.equal(pilotFreshness(frame, time + 91_000).fresh, false);
  assert.equal(pilotFreshness(null, time).fresh, false);
  assert.equal(frame.quotes[0].trade?.asOf, iso(time - 1000));
});

test("a provider/budget error aborts the cycle without subsequent calls", async () => {
  let calls = 0;
  await assert.rejects(collectCoinApiPilot({ usage: () => ({}), get: async () => {
    calls++; throw new Error("Allowance exhausted");
  } }, state(), () => time));
  assert.equal(calls, 1);
});

test("batch metadata transport keeps the API key in the header and fixed origin", async () => {
  const client = createCoinApiClient({ apiKey: "test", capabilities, fetcher: async (input, init) => {
    assert.equal(new URL(String(input)).origin, "https://rest.coinapi.io");
    assert.equal(new Headers(init?.headers).get("X-CoinAPI-Key"), "test");
    return Response.json([]);
  } });
  await client.get("/v1/symbols?filter_exchange_id=COINBASE,KRAKEN");
  await assert.rejects(client.get("/v1/symbolsevil?filter_exchange_id=COINBASE"));
});

test("durable budget denial prevents network calls", async () => {
  let calls = 0;
  const wrapped = budgetedCoinApiFetch({ reserve: async () => false, settle: async () => true }, async () => {
    calls++; return Response.json({});
  }, Date.now, capabilities);
  await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"));
  assert.equal(calls, 0);
});

test("uncertain reservation stops a process; no network or optimistic retry", async () => {
  let reservations = 0, calls = 0;
  const wrapped = budgetedCoinApiFetch({ reserve: async () => { reservations++; throw new Error("DB timeout"); },
    settle: async () => true }, async () => { calls++; return Response.json({}); }, Date.now, capabilities);
  await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"));
  await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"));
  assert.equal(reservations, 1); assert.equal(calls, 0);
});

for (const header of [null, "", "abc", "-1", "Infinity", "2"]) {
  test(`missing/unexpected cost ${JSON.stringify(header)} blocks subsequent provider requests`, async () => {
    let calls = 0, receipts = 0;
    const wrapped = budgetedCoinApiFetch({ reserve: async () => true, settle: async () => { receipts++; return true; } }, async () => {
      calls++; return Response.json({}, { headers: header === null ? {} : { "x-ratelimit-request-cost": header } });
    }, Date.now, capabilities);
    await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"));
    await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"));
    assert.equal(calls, 1); assert.equal(receipts, 1);
  });
}

test("network timeout is settled as unknown, not refunded or retried", async () => {
  const receipts: unknown[] = [];
  const wrapped = budgetedCoinApiFetch({ reserve: async () => true, settle: async (_id, cost, status) => {
    receipts.push([cost, status]); return false;
  } }, async () => { throw new Error("credential-leaking-error"); }, Date.now, capabilities);
  await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"), /uncertain/);
  assert.deepEqual(receipts, [[null, 0]]);
});

test("accounting outage prevents using a response as verified/accounted data", async () => {
  const wrapped = budgetedCoinApiFetch({ reserve: async () => true, settle: async () => { throw new Error("DB down"); } },
    async () => Response.json({}, { headers: { "x-ratelimit-request-cost": "1" } }), Date.now, capabilities);
  await assert.rejects(wrapped("https://rest.coinapi.io/v1/quotes/current"), /accounting/);
});

test("valid cost is settled once before exposing the payload", async () => {
  const receipts: unknown[] = [];
  const wrapped = budgetedCoinApiFetch({ reserve: async () => true, settle: async (_id, cost, status) => {
    receipts.push([cost, status]); return true;
  } }, async () => Response.json({ good: true }, { headers: { "x-ratelimit-request-cost": "1" } }), Date.now, capabilities);
  const response = await wrapped("https://rest.coinapi.io/v1/quotes/current");
  assert.deepEqual(receipts, [[1, 200]]);
  assert.deepEqual(await response.json(), { good: true });
});
