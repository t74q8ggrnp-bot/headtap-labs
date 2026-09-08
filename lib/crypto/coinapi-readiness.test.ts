import assert from "node:assert/strict";
import test from "node:test";
import type { CoinApiMarket } from "./coinapi-normalize";
// @ts-expect-error Node source imports.
import { parseCoinApiBars, parseCoinApiBook, buildCoinApiChart } from "./coinapi-normalize.ts";
// @ts-expect-error Node source imports.
import { mergeCoinApiHistory, planCoinApiHistory, boundCoinApiHistory } from "./coinapi-history.ts";
// @ts-expect-error Node source imports.
import { collectCoinApiPilot } from "./coinapi-pilot.ts";
// @ts-expect-error Node source imports.
import { canonicalCryptoJson, presentCoinApiPublication } from "./coinapi-publication.ts";
// @ts-expect-error Node source imports.
import { legacyCryptoOutcomeQuarantine, legacyCryptoObservationOnly, isVerifiedCryptoOutcomeSource } from "./outcome-integrity.ts";

const now = Date.parse("2026-09-02T22:00:00Z");
const iso = (seconds: number) => new Date(now + seconds * 1_000).toISOString();
const market: CoinApiMarket = { symbolId: "COINBASE_SPOT_BTC_USD", venue: "COINBASE", base: "BTC", quote: "USD", catalogAsOf: null, volume30d: null };
const rawBars = Array.from({ length: 65 }, (_, i) => ({ time_period_start: iso((i - 65) * 60), time_period_end: iso((i - 64) * 60),
  time_open: iso((i - 65) * 60 + 1), time_close: iso((i - 64) * 60 - 1),
  price_open: 10, price_high: 12, price_low: 9, price_close: 11, volume_traded: 1000 }));
const rawQuote = { symbol_id: market.symbolId, time_exchange: iso(-1), bid_price: 10.99, ask_price: 11.01, bid_size: 50, ask_size: 100,
  last_trade: { price: 11, size: 2, time_exchange: iso(-1) } };
const bars = () => parseCoinApiBars(rawBars, now);
const cache = () => ({ marketId: market.symbolId, fetchedAt: iso(-1), bars: bars() });
async function collected() {
  return collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => path.startsWith("/v1/ohlcv/") ? rawBars : [rawQuote] },
    { catalog: [market], catalogAt: iso(-60), cursor: 0, priorityMarket: null, previousQuotes: [] }, () => now);
}

test("same-version candle conflict fails in either order; identical retransmits are harmless", () => {
  const one = rawBars[0], other = { ...one, price_close: 10 };
  assert.throws(() => parseCoinApiBars([one,other],now),/conflicting/);
  assert.throws(() => parseCoinApiBars([other,one],now),/conflicting/);
  assert.equal(parseCoinApiBars([one,one],now).length,1);
  assert.throws(() => mergeCoinApiHistory(bars(),[{ ...bars()[0],close:10 }]),/conflicting/);
});

test("shared history reuses complete minutes, fetches only missing overlap, and expires", () => {
  assert.equal(planCoinApiHistory(market.symbolId,cache(),now).path,null);
  assert.match(planCoinApiHistory(market.symbolId,cache(),now + 60_000).path!,/limit=4$/);
  assert.match(planCoinApiHistory(market.symbolId,cache(),now + 3_600_000).path!,/limit=65$/);
  assert.match(planCoinApiHistory("KRAKEN_SPOT_BTC_USD",cache(),now).path!,/limit=65$/);
  const missingMinute = { ...cache(), bars: bars().filter((_,i) => i !== 30) };
  assert.match(planCoinApiHistory(market.symbolId,missingMinute,now).path!,/limit=65$/);
});

test("history revisions never overwrite newer provider evidence and cache stays bounded", () => {
  const prior = bars()[0], older = { ...prior, closeAsOf: iso(-65 * 60 + 1), close: 10 };
  assert.equal(mergeCoinApiHistory([prior],[older])[0].close,11);
  const entries = Object.fromEntries(Array.from({ length: 140 }, (_,i) => [String(i), { ...cache(),marketId:String(i) }]));
  assert.equal(Object.keys(boundCoinApiHistory(entries,new Set(Object.keys(entries)))).length,128);
  assert.equal(Object.keys(boundCoinApiHistory(entries,new Set(["1"])))[0],"1");
});

test("repeat selections use stored candles and request only the shared batch quote", async () => {
  const first = await collected(); const calls: string[] = [];
  const second = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) => {
    calls.push(path); return [rawQuote];
  } },first.state,() => now);
  assert.equal(calls.length,1); assert.match(calls[0],/quotes\/current/);
  assert.equal(second.frame.history.cacheHits,1);
  assert.equal(second.frame.history.requests,0);
});

test("invalid history quarantines the selected market without dropping its coverage", async () => {
  const result = await collectCoinApiPilot({ usage: () => ({}), get: async (path: string) =>
    path.startsWith("/v1/ohlcv/") ? [...rawBars,{ ...rawBars[0],price_close:10 }] : [rawQuote] },
    { catalog:[market],catalogAt:iso(-60),cursor:0,priorityMarket:null,previousQuotes:[] },()=>now);
  assert.equal(result.frame.summary.scored,0);
  assert.equal(result.frame.coverage.length,1);
  assert.ok(result.frame.coverage[0].failures.includes("conflicting_or_invalid_candle_history"));
  assert.equal(presentCoinApiPublication(result.frame,now).markets[0].chart,null);
});

test("one backend publication gives desktop and native the exact chart close and provider clock", async () => {
  const { frame } = await collected(); const original = canonicalCryptoJson(frame);
  const desktop = presentCoinApiPublication(frame,now), mobile = presentCoinApiPublication(frame,now,market.symbolId);
  assert.deepEqual(desktop.markets[0],mobile.markets[0]);
  const row = desktop.markets[0];
  assert.equal(row.price,row.chart?.bars.at(-1)?.close);
  assert.equal(row.priceAsOf,row.chart?.displayQuote.asOf);
  assert.equal(canonicalCryptoJson(frame),original);
  assert.equal(row.executionAuthorized,false);
  const stale = presentCoinApiPublication(frame,now + 61_000).markets[0];
  assert.equal(stale.priceStatus,"stale"); assert.equal(stale.executionQuoteCurrent,false);
  assert.equal(stale.priceAsOf,row.priceAsOf);
  assert.equal(presentCoinApiPublication(frame,now + 16_000).markets[0].bookAgeSeconds,17);
});

test("JSONB key ordering preserves content hash but changed evidence does not", () => {
  assert.equal(canonicalCryptoJson({ z:1,a:{ b:2,a:3 } }),canonicalCryptoJson({ a:{ a:3,b:2 },z:1 }));
  assert.notEqual(canonicalCryptoJson({ price:1 }),canonicalCryptoJson({ price:2 }));
  assert.throws(()=>canonicalCryptoJson({ price:Infinity }),/Non-finite/);
});

test("book sizes and provider receipt time are retained, absent sizes never become liquidity", () => {
  const book = parseCoinApiBook({ ...rawQuote,time_coinapi:iso(-.5) },market.symbolId,now);
  assert.equal(book.bidSize,50); assert.equal(book.askSize,100);
  assert.equal(book.receivedByProviderAt,iso(-.5));
  assert.equal(parseCoinApiBook({ ...rawQuote,ask_size:undefined },market.symbolId,now).askSize,null);
});

test("chart trade merge marks provisional volume without inventing it", () => {
  const result = buildCoinApiChart(market,bars(),{ symbolId:market.symbolId,price:11.5,size:1,asOf:iso(-.5),receivedByProviderAt:null },now);
  assert.equal(result.displayQuote.price,11.5); assert.equal(result.volumeProvisional,true);
  assert.equal(result.bars.at(-1)?.volume,1000);
});

test("legacy observations are explicitly excluded and never claimed as repaired history", () => {
  assert.equal(legacyCryptoOutcomeQuarantine().evaluationEligible,false);
  assert.equal(legacyCryptoOutcomeQuarantine().historicalPricesReconstructed,false);
  assert.equal(isVerifiedCryptoOutcomeSource("ht_crypto_prox_observations"),false);
  assert.equal(isVerifiedCryptoOutcomeSource("ht_crypto_discovery_observations"),false);
  assert.equal(isVerifiedCryptoOutcomeSource("coinapi-provider-book-ledger-v1"),true);
  assert.deepEqual(legacyCryptoObservationOnly(), { outcome_tracking_status:"not_scheduled",
    target_15m_at:null,target_1h_at:null,target_4h_at:null,target_24h_at:null });
});
