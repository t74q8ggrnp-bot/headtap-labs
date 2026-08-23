import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { scoreCryptoOpportunity } from "./opportunity-engine.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { buildCryptoProxPacket } from "./prox.ts";

const now = new Date("2026-08-23T14:00:00.000Z");
const start = now.getTime() / 1_000 - 60 * 60;
const opportunity = scoreCryptoOpportunity({
  productId: "TEST-USD",
  symbol: "TEST",
  open: 10,
  high: 12,
  low: 9,
  last: 11.5,
  volume24h: 1_000_000,
  volume30d: 15_000_000,
})!;

function risingCandles(flat = false) {
  return Array.from({ length: 60 }, (_, index) => {
    const close = flat ? 10 : 10 + index * 0.01;
    return {
      time: start + index * 60,
      low: close - 0.01,
      high: close + 0.01,
      open: close - 0.005,
      close,
      volume: 100 + index,
    };
  });
}

test("builds a fresh live-tape packet from complete minute evidence", () => {
  const candles = risingCandles();
  const packet = buildCryptoProxPacket({
    opportunity,
    candles,
    benchmarkCandles: risingCandles(true),
    quote: {
      price: candles.at(-1)!.close,
      bid: candles.at(-1)!.close - 0.005,
      ask: candles.at(-1)!.close + 0.005,
      time: null,
    },
    now,
  });
  assert.equal(packet.fresh, true);
  assert.equal(packet.barCount, 60);
  assert.notEqual(packet.state, "stale");
  assert.equal(packet.riskFlags.includes("market_pulse_stale"), false);
});

test("fails closed when the minute tape is stale", () => {
  const candles = risingCandles();
  const packet = buildCryptoProxPacket({
    opportunity,
    candles,
    benchmarkCandles: risingCandles(true),
    quote: null,
    now: new Date(now.getTime() + 10 * 60_000),
  });
  assert.equal(packet.fresh, false);
  assert.equal(packet.state, "stale");
  assert.equal(packet.marketConfirmation, 0);
  assert.equal(packet.proposedScoreAdjustment, 0);
  assert.ok(packet.riskFlags.includes("market_pulse_stale"));
});

test("confirms a post-peak breakdown only when multiple tape signals agree", () => {
  const candles = risingCandles().map((candle, index) => {
    if (index < 48) return candle;
    const close = 10.47 - (index - 47) * 0.09;
    return {
      ...candle,
      open: close + 0.04,
      high: close + 0.05,
      low: close - 0.05,
      close,
      volume: index >= 57 ? 1_000 : 200,
    };
  });
  const last = candles.at(-1)!.close;
  const packet = buildCryptoProxPacket({
    opportunity,
    candles,
    benchmarkCandles: risingCandles(true),
    quote: { price: last, bid: last - 0.005, ask: last + 0.005, time: null },
    now,
  });
  assert.equal(packet.features.peakFailureConfirmed, true);
  assert.equal(packet.state, "weakening");
  assert.equal(packet.proposedScoreAdjustment, -12);
  assert.ok(packet.riskFlags.includes("post_peak_breakdown"));
});
