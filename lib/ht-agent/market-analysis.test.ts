import assert from "node:assert/strict";
import test from "node:test";
import type { MarketChartBar, MarketChartDisplayQuote } from "../market-chart";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { deriveHtAgentMarketAnalysis } from "./market-analysis.ts";

function bars(direction: "up" | "down"): MarketChartBar[] {
  return Array.from({ length: 20 }, (_, index) => {
    const base = direction === "up" ? 100 + index : 120 - index;
    return {
      time: 1_700_000_000 + index * 60,
      open: base,
      high: base + 1,
      low: base - 1,
      close: direction === "up" ? base + 0.5 : base - 0.5,
      volume: 1_000 + index * 10,
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

test("Agent market analysis describes strengthening tape without creating trading authority", () => {
  const analysis = deriveHtAgentMarketAnalysis({ bars: bars("up"), quote: quote(120) });
  assert.equal(analysis?.state, "strengthening");
  assert.match(analysis?.headline ?? "", /VWAP/);
  assert.equal("score" in (analysis ?? {}), false);
  assert.equal("target" in (analysis ?? {}), false);
  assert.equal("entry" in (analysis ?? {}), false);
  assert.equal("stop" in (analysis ?? {}), false);
  assert.equal("paperEligible" in (analysis ?? {}), false);
});

test("Agent market analysis describes weakening tape and retains observed, not predicted, levels", () => {
  const analysis = deriveHtAgentMarketAnalysis({ bars: bars("down"), quote: quote(99) });
  assert.equal(analysis?.state, "weakening");
  assert.equal(analysis?.observedHigh, 121);
  assert.equal(analysis?.observedLow, 100);
});

test("Agent market analysis is honest when the verified tape is limited", () => {
  const analysis = deriveHtAgentMarketAnalysis({ bars: bars("up").slice(0, 6), quote: quote(106) });
  assert.equal(analysis?.state, "limited");
  assert.match(analysis?.explanation ?? "", /does not yet contain enough traded intervals/);
});

test("Agent market analysis waits when no provider-backed market frame exists", () => {
  assert.equal(deriveHtAgentMarketAnalysis({ bars: [], quote: null }), null);
});
