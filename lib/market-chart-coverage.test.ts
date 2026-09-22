import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { MARKET_CHART_SPARSE_COVERAGE_THRESHOLD_PERCENT, marketChartCoverageIsSparse, resolveMarketChartVisibleCoverage } from "./market-chart-rendering.ts";
import type { MarketChartTimeSlot } from "./market-chart";

const slots = (count: number, populated: Set<number>): MarketChartTimeSlot[] =>
  Array.from({ length: count }, (_, index) => ({
    time: (index + 1) * 60,
    bar: populated.has(index)
      ? {
          time: (index + 1) * 60,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
        }
      : null,
  }));

test("visible coverage counts provider bars and preserves blank intervals", () => {
  const populated = new Set(Array.from({ length: 34 }, (_, index) => index + 60));
  const coverage = resolveMarketChartVisibleCoverage(
    slots(120, populated),
    { from: 60, to: 122 },
  );

  assert.deepEqual(coverage, {
    expectedIntervalCount: 60,
    renderedProviderBarCount: 34,
    coveragePercentage: 57,
  });
  assert.equal(MARKET_CHART_SPARSE_COVERAGE_THRESHOLD_PERCENT, 70);
});

test("39 of 60 visible provider intervals immediately disclose sparse tape", () => {
  const coverage = resolveMarketChartVisibleCoverage(
    slots(60, new Set(Array.from({ length: 39 }, (_, index) => index))),
    { from: 0, to: 60 },
  );

  assert.deepEqual(coverage, {
    expectedIntervalCount: 60,
    renderedProviderBarCount: 39,
    coveragePercentage: 65,
  });
  assert.equal(marketChartCoverageIsSparse(coverage), true);
});

test("liquid visible ranges do not display sparse tape", () => {
  assert.equal(marketChartCoverageIsSparse({
    expectedIntervalCount: 60,
    renderedProviderBarCount: 60,
    coveragePercentage: 100,
  }), false);
});

test("visible coverage follows a panned viewport without altering chart slots", () => {
  const frame = slots(120, new Set([10, 11, 12, 13, 14, 15, 100]));
  const snapshot = structuredClone(frame);

  assert.deepEqual(
    resolveMarketChartVisibleCoverage(frame, { from: 10, to: 16 }),
    {
      expectedIntervalCount: 6,
      renderedProviderBarCount: 6,
      coveragePercentage: 100,
    },
  );
  assert.deepEqual(frame, snapshot);
});

test("visible coverage returns null before a usable viewport exists", () => {
  assert.equal(resolveMarketChartVisibleCoverage([], { from: 0, to: 60 }), null);
  assert.equal(resolveMarketChartVisibleCoverage(slots(60, new Set()), null), null);
});
