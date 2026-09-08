import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error strip-types runner
import { buildMassiveCryptoChart } from "./massive-crypto-chart.ts";

const now = Date.parse("2026-09-02T19:30:25Z");
const bars = { ticker: "X:BTCUSD", results: [
  { t: now - 85_000, o: 100, h: 103, l: 99, c: 101, v: 5 },
  { t: now - 25_000, o: 101, h: 105, l: 100, c: 103, v: 10 },
] };
const snapshot = (p = 104, t = now - 1000) => ({ ticker: { ticker: "X:BTCUSD", lastTrade: { p, t } } });

test("Massive crypto supplies one provider-time candle close and current price, without double-counting volume", () => {
  const view = buildMassiveCryptoChart("BTC", snapshot(), bars, now);
  assert.equal(view.displayQuote.price, 104);
  assert.equal(view.bars.at(-1)!.close, 104);
  assert.equal(view.bars.at(-1)!.volume, 10);
  assert.equal(view.displayQuote.asOf, new Date(now - 1000).toISOString());
  assert.equal(view.displayQuote.live, true);
  assert.equal(view.displayQuote.changeBasis, "chart_open");
});
test("missing/stale/future/incorrect-unit crypto trade times never masquerade as live", () => {
  for (const time of [now - 120_000, now + 10_000, now * 1_000_000, now / 1000, NaN]) {
    const view = buildMassiveCryptoChart("BTC", snapshot(104, time), bars, now);
    assert.equal(view.displayQuote.live, false);
    assert.equal(view.displayQuote.price, view.bars.at(-1)!.close);
  }
});
test("unsupported or conflicting crypto identities fail closed, not to another provider", () => {
  assert.throws(() => buildMassiveCryptoChart("ETH", snapshot(), bars, now), /identity mismatch/);
  assert.throws(() => buildMassiveCryptoChart("BTC", snapshot(), { ticker: "X:BTCUSD", results: [] }, now), /unavailable/);
});
test("crypto prices below one millionth of a dollar retain real candles", () => {
  const tiny = { ...bars, results: bars.results.map(b => ({ ...b, o: 0.00000011, h: 0.00000014, l: 0.0000001, c: 0.00000012 })) };
  const view = buildMassiveCryptoChart("BTC", snapshot(0.0000001234), tiny, now);
  assert.equal(view.displayQuote.price, 0.0000001234);
  assert.equal(view.bars.at(-1)!.close, view.displayQuote.price);
  assert.equal(view.displayQuote.live, true);
});
