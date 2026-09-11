import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { marketChartIsFollowingLatest, marketChartVisibleLogicalRange } from "./market-chart-visible-range.ts";

test("visible chart ranges keep one and two hours separate from the loaded session", () => {
  assert.deepEqual(marketChartVisibleLogicalRange({
    visibleRange: "1h",
    legacyVisibleMinutes: 180,
    intervalSeconds: 60,
    pointCount: 390,
  }), { from: 330, to: 392 });
  assert.deepEqual(marketChartVisibleLogicalRange({
    visibleRange: "2h",
    legacyVisibleMinutes: 180,
    intervalSeconds: 300,
    pointCount: 78,
  }), { from: 54, to: 80 });
  assert.deepEqual(marketChartVisibleLogicalRange({
    visibleRange: "session",
    legacyVisibleMinutes: 180,
    intervalSeconds: 900,
    pointCount: 26,
  }), { from: 0, to: 28 });
});

test("new candles follow only while the latest candle remains visible", () => {
  assert.equal(marketChartIsFollowingLatest({ from: 270, to: 392 }, 390), true);
  assert.equal(marketChartIsFollowingLatest({ from: 120, to: 300 }, 390), false);
  assert.equal(marketChartIsFollowingLatest(null, 390), true);
});
