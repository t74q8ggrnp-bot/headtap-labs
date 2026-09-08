import assert from "node:assert/strict";
import test from "node:test";
import type { CryptoLiveResearchInput, CryptoResearchCosts } from "./live-research";
// @ts-expect-error Node's built-in TypeScript runner needs source extensions.
import { CRYPTO_LIVE_RESEARCH_POLICY, evaluateCryptoLiveResearch, rankCryptoLiveResearch } from "./live-research.ts";
// @ts-expect-error Node's built-in TypeScript runner needs source extensions.
import { coinApiResearchEvidence } from "./live-research-coinapi.ts";
// @ts-expect-error Node's built-in TypeScript runner needs source extensions.
import { scoreCryptoOpportunity } from "./opportunity-engine.ts";

const NOW = Date.parse("2026-09-02T22:01:10.000Z");
const costs: CryptoResearchCosts = { version: "fixture-fees-v1", feeBpsPerSide: 10, slippageBpsPerSide: 5 };
function fixture(direction = 1, scale = 1): CryptoLiveResearchInput {
  let price = 10 * scale;
  const candles = Array.from({ length: 61 }, (_, i) => {
    const open = price;
    price *= 1 + (i >= 46 ? direction * 0.002 : (i % 2 ? -0.0005 : 0.0005));
    const time = Math.floor(NOW / 60_000) * 60 - (61 - i) * 60;
    return { time, asOf: new Date(time * 1_000 + 59_900).toISOString(), open,
      high: Math.max(open, price) * 1.001, low: Math.min(open, price) * 0.999, close: price,
      volume: (i >= 56 ? 250_000 : 100_000) / scale };
  });
  return {
    identity: { provider: "coinapi", marketId: "COINBASE_SPOT_TEST_USD", base: "TEST", quote: "USD" },
    decisionAt: new Date(NOW).toISOString(), trade: { price, asOf: new Date(NOW - 1_000).toISOString() },
    book: { bid: price * 0.9995, ask: price * 1.0005, asOf: new Date(NOW - 500).toISOString() },
    candles, marketState: "normal",
  };
}

test("new raw-evidence model prefers developing momentum over a fading daily winner", () => {
  const developing = fixture(1);
  const fading = fixture(-1);
  fading.identity.marketId = "KRAKEN_SPOT_TEST_USD";
  const first = evaluateCryptoLiveResearch(developing, costs);
  const second = evaluateCryptoLiveResearch(fading, costs);
  assert.deepEqual(first.failures, []);
  assert.ok(first.score! > second.score!);
  assert.equal(first.state, "strengthening");
  assert.equal(second.state, "cooling");
  assert.ok(first.features!.volumeAcceleration5m > 1);
  assert.ok(second.components!.participation < first.components!.participation);
  const oldQuiet = scoreCryptoOpportunity({ productId: "TEST-USD", symbol: "TEST", open: developing.trade.price / 1.01,
    high: developing.trade.price * 1.05, low: 9, last: developing.trade.price, volume24h: 2e6, volume30d: 4e7 })!;
  const oldGainer = scoreCryptoOpportunity({ productId: "TEST-USD", symbol: "TEST", open: fading.trade.price / 1.3,
    high: fading.trade.price * 1.05, low: 6, last: fading.trade.price, volume24h: 2e6, volume30d: 4e7 })!;
  assert.equal(oldQuiet.eligible, false); // Prior 3% daily floor misses this raw pattern.
  assert.ok(oldGainer.opportunityScore > oldQuiet.opportunityScore);
  const frame = rankCryptoLiveResearch([fading, developing], costs);
  assert.equal(frame.rankedMarkets[0], developing.identity.marketId);
  assert.equal(frame.publicRankingChanged, false);
});

test("24h move, canonical conclusions and outcome labels cannot change the score", () => {
  const input = fixture();
  const reference = evaluateCryptoLiveResearch(input, costs);
  const poisoned = Object.assign(structuredClone(input), {
    change24hPercent: 999, opportunityScore: 100, rank: 1, eligible: true,
    crowdScore: 0, trapScore: 0, futureReturn: 9_999, proxEdgeScore: 100,
  });
  assert.deepEqual(evaluateCryptoLiveResearch(poisoned, costs), reference);
});

test("sub-dollar and tiny meme-coin prices retain scale invariance; no dollar floor", () => {
  const normal = evaluateCryptoLiveResearch(fixture(), costs);
  const tiny = evaluateCryptoLiveResearch(fixture(1, 1e-8), costs);
  assert.equal(tiny.score, normal.score);
  assert.equal(tiny.state, normal.state);
  assert.ok(tiny.features!.breakEvenExitBid! > 0);
  assert.ok(tiny.features!.breakEvenExitBid! < 0.000001);
});

test("flat movement and a large old gain cannot generate strengthening", () => {
  const input = fixture(0);
  const output = evaluateCryptoLiveResearch(input, costs);
  assert.notEqual(output.state, "strengthening");
  assert.ok(output.score! < evaluateCryptoLiveResearch(fixture(), costs).score!);
});

test("existing stablecoin, wrapped and leveraged routing is preserved", () => {
  for (const base of ["USDC", "WBTC", "ETH3L"]) {
    const input = fixture(); input.identity.base = base;
    assert.equal(evaluateCryptoLiveResearch(input, costs).score, null);
  }
  for (const base of ["PEPE", "WIF", "DOGE"]) {
    const input = fixture(); input.identity.base = base;
    assert.notEqual(evaluateCryptoLiveResearch(input, costs).score, null);
  }
});

test("numerical overflow never produces a publishable NaN score", () => {
  const input = fixture(); input.candles.forEach(bar => { bar.volume = Number.MAX_VALUE; });
  assert.equal(evaluateCryptoLiveResearch(input, costs).score, null);
});

test("fees, slippage and executable sides produce exact break-even math", () => {
  const input = fixture();
  const output = evaluateCryptoLiveResearch(input, costs);
  const expected = input.book!.ask * 1.0005 * 1.001 / (0.9995 * 0.999);
  assert.equal(output.features!.breakEvenExitBid, expected);
  assert.ok(output.features!.roundTripCostPercent! > output.features!.spreadPercent);
  const expensive = evaluateCryptoLiveResearch(input, { ...costs, feeBpsPerSide: 100 });
  assert.ok(expensive.score! < output.score!);
  assert.ok(expensive.features!.roundTripCostPercent! > output.features!.roundTripCostPercent!);
});

test("missing costs are explicit, not zero fees or implied profitability", () => {
  const output = evaluateCryptoLiveResearch(fixture());
  assert.equal(output.features!.roundTripCostPercent, null);
  assert.equal(output.features!.breakEvenExitBid, null);
  assert.equal(output.probabilityOfProfit, null);
  assert.equal(output.expectedNetReturnPercent, null);
  assert.equal(output.executionAuthorized, false);
  assert.ok(output.observations.some(line => line.includes("unspecified")));
});

const failures: Array<[string, (input: CryptoLiveResearchInput) => void, string]> = [
  ["stale trade", input => { input.trade.asOf = new Date(NOW - 31_000).toISOString(); }, "invalid_or_stale_trade"],
  ["stale book", input => { input.book!.asOf = new Date(NOW - 16_000).toISOString(); }, "invalid_or_stale_book"],
  ["misaligned price/book", input => { input.trade.asOf = new Date(NOW - 25_000).toISOString(); }, "trade_book_misaligned"],
  ["future trade", input => { input.trade.asOf = new Date(NOW + 3_000).toISOString(); }, "invalid_or_stale_trade"],
  ["missing book", input => { input.book = null; }, "invalid_or_stale_book"],
  ["crossed book", input => { input.book!.bid = input.book!.ask * 2; }, "invalid_or_stale_book"],
  ["missing provider time", input => { input.trade.asOf = ""; }, "invalid_or_stale_trade"],
  ["timezone-less time", input => { input.trade.asOf = "2026-09-02T22:01:09"; }, "invalid_or_stale_trade"],
  ["bad OHLC", input => { input.candles[10].low = input.candles[10].high * 2; }, "invalid_or_future_candle"],
  ["negative volume", input => { input.candles[10].volume = -1; }, "invalid_or_future_candle"],
  ["gap", input => { input.candles.splice(20, 1); }, "incomplete_minute_history"],
  ["stale candles", input => { input.candles.forEach(bar => { bar.time -= 300; bar.asOf = new Date(Date.parse(bar.asOf) - 300_000).toISOString(); }); }, "stale_or_misaligned_candles"],
  ["bad print", input => { input.trade.price *= 2; }, "trade_candle_divergence"],
  ["halted", input => { input.marketState = "halted"; }, "market_integrity_failure"],
  ["suspect", input => { input.marketState = "suspect"; }, "market_integrity_failure"],
  ["empty baseline", input => { input.candles.forEach(bar => { bar.volume = 0; }); }, "insufficient_activity_baseline"],
  ["invalid decision clock", input => { input.decisionAt = "invalid"; }, "invalid_decision_time"],
];
for (const [name, mutate, expected] of failures) {
  test(`${name} abstains rather than inventing a score`, () => {
    const input = fixture(); mutate(input);
    const result = evaluateCryptoLiveResearch(input, costs);
    assert.ok(result.failures.includes(expected), result.failures.join(","));
    assert.equal(result.score, null);
    assert.equal(result.executionAuthorized, false);
  });
}

test("candle revisions with conflicting values cannot be silently deduplicated", () => {
  const input = fixture();
  input.candles.push({ ...input.candles[0], volume: 10 });
  assert.ok(evaluateCryptoLiveResearch(input, costs).failures.includes("conflicting_candle_versions"));
});

test("input order and identical duplicates do not change the result", () => {
  const input = fixture();
  const reference = evaluateCryptoLiveResearch(input, costs);
  input.candles.reverse(); input.candles.push({ ...input.candles[0] });
  assert.deepEqual(evaluateCryptoLiveResearch(input, costs), reference);
});

test("an in-progress candle does not leak into completed-minute momentum", () => {
  const input = fixture();
  const reference = evaluateCryptoLiveResearch(input, costs);
  input.candles.push({ ...input.candles.at(-1)!, time: Math.floor(NOW / 60_000) * 60,
    asOf: new Date(NOW - 1_000).toISOString(), high: 50, close: 50 });
  assert.deepEqual(evaluateCryptoLiveResearch(input, costs), reference);
});

test("10s/30s features require actual timestamped trades", () => {
  const input = fixture();
  assert.equal(evaluateCryptoLiveResearch(input, costs).features!.return10s, null);
  input.recentTrades = [
    { price: input.trade.price / 1.01, asOf: new Date(Date.parse(input.trade.asOf) - 10_000).toISOString() },
    { price: input.trade.price / 1.02, asOf: new Date(Date.parse(input.trade.asOf) - 30_000).toISOString() },
  ];
  const result = evaluateCryptoLiveResearch(input, costs);
  assert.equal(result.features!.return10s, 1);
  assert.equal(result.features!.return30s, 2);
});

test("all candidates including unavailable data remain in the audit denominator", () => {
  const first = fixture(), second = fixture();
  second.identity.marketId = "KRAKEN_SPOT_OTHER_USD"; second.book = null;
  const result = rankCryptoLiveResearch([first, second], costs);
  assert.equal(result.evaluated, 2); assert.equal(result.scored, 1); assert.equal(result.unavailable, 1);
  assert.equal(result.decisions.length, 2);
  assert.throws(() => rankCryptoLiveResearch([first, first], costs), /Duplicate/);
  second.decisionAt = new Date(NOW - 10_000).toISOString();
  assert.throws(() => rankCryptoLiveResearch([first, second], costs), /one decision timestamp/);
});

test("scoring is deterministic, bounded, immutable and weight contract totals 100", () => {
  const input = fixture(); const before = structuredClone(input);
  assert.deepEqual(evaluateCryptoLiveResearch(input, costs), evaluateCryptoLiveResearch(input, costs));
  assert.deepEqual(input, before);
  assert.equal(Object.values(CRYPTO_LIVE_RESEARCH_POLICY.weights).reduce<number>((a, b) => a + b, 0), 100);
  assert.ok(Object.isFrozen(CRYPTO_LIVE_RESEARCH_POLICY.weights));
  assert.equal(CRYPTO_LIVE_RESEARCH_POLICY.scanIntervalMs, 60_000);
  assert.ok(evaluateCryptoLiveResearch(input, costs).score! <= 100);
  assert.ok(evaluateCryptoLiveResearch(input, costs).score! >= 0);
  assert.ok(evaluateCryptoLiveResearch(input, { ...costs, feeBpsPerSide: NaN }).failures.includes("invalid_cost_assumptions"));
});

test("CoinAPI bridge preserves independent timestamps and exact market identity", () => {
  const input = fixture();
  const args = {
    market: { symbolId: input.identity.marketId, venue: "COINBASE" as const, base: "TEST", quote: "USD", catalogAsOf: null, volume30d: null },
    trade: { symbolId: input.identity.marketId, ...input.trade, size: null, receivedByProviderAt: null },
    book: { symbolId: input.identity.marketId, ...input.book! },
    bars: input.candles.map(bar => ({ ...bar, closeAsOf: bar.asOf })), decisionAt: input.decisionAt,
  };
  const evidence = coinApiResearchEvidence(args);
  assert.deepEqual(evidence.trade, input.trade);
  assert.deepEqual(evidence.book, input.book);
  assert.equal(evidence.marketState, "unavailable");
  assert.equal(evaluateCryptoLiveResearch(evidence, costs).score, evaluateCryptoLiveResearch(input, costs).score);
  assert.throws(() => coinApiResearchEvidence({ ...args, trade: { ...args.trade, symbolId: "KRAKEN_SPOT_TEST_USD" } }), /identity/);
  assert.throws(() => coinApiResearchEvidence({ ...args, market: { ...args.market, quote: "USDT" } }), /identity/);
});
