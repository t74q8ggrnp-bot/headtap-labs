import assert from "node:assert/strict";
import test from "node:test";
import type { MarketChartBar, MarketChartDisplayQuote } from "./market-chart";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { calculateHtMarketScore, validHtMarketScoreReceipt } from "./market-score.ts";

function bars(direction: "up" | "down", count = 120): MarketChartBar[] {
  return Array.from({ length: count }, (_, index) => {
    const base = direction === "up" ? 100 + index * 0.1 : 112 - index * 0.1;
    return {
      time: 1_780_000_000 + index * 60,
      open: base,
      high: base + 0.15,
      low: base - 0.15,
      close: direction === "up" ? base + 0.08 : base - 0.08,
      volume: 1_000 + index * 4,
    };
  });
}

function quote(price: number): MarketChartDisplayQuote {
  return {
    price,
    changePercent: 1,
    asOf: "2026-09-24T16:00:00.000Z",
    live: true,
    source: "massive_polygon_last_trade",
  };
}

test("live Market Score Beta rewards aligned strengthening structure", () => {
  const receipt = calculateHtMarketScore({ bars: bars("up"), quote: quote(112), assetKind: "etf" });
  assert.ok(receipt);
  assert.ok(receipt.score >= 65);
  assert.equal(receipt.assetKind, "etf");
  assert.deepEqual(receipt.authority, {
    canonical: false,
    prox: false,
    agentRisk: false,
    paper: false,
    execution: false,
  });
});

test("weakening structure scores below aligned strengthening structure", () => {
  const strengthening = calculateHtMarketScore({ bars: bars("up"), quote: quote(112), assetKind: "stock" });
  const weakening = calculateHtMarketScore({ bars: bars("down"), quote: quote(99.9), assetKind: "stock" });
  assert.ok(strengthening && weakening);
  assert.ok(weakening.score < strengthening.score);
});

test("score waits for enough verified bars instead of inventing evidence", () => {
  assert.equal(calculateHtMarketScore({ bars: bars("up", 10), quote: quote(101), assetKind: "etf" }), null);
});

test("only persisted server receipts satisfy the public transport contract", () => {
  const calculated = calculateHtMarketScore({ bars: bars("up"), quote: quote(112), assetKind: "etf" });
  assert.ok(calculated);
  assert.equal(validHtMarketScoreReceipt(calculated), false);
  assert.equal(validHtMarketScoreReceipt({ ...calculated, receiptState: "persisted" }), true);
  assert.equal(validHtMarketScoreReceipt({
    ...calculated,
    receiptState: "persisted",
    inputs: { ...calculated.inputs, vwap: Number.NaN },
  }), false);
});
