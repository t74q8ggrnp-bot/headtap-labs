import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { assessProxMarketStructure } from "./market-structure.ts";

function bars(count: number, start = 10, step = 0.05) {
  return Array.from({ length: count }, (_, index) => {
    const close = start + index * step;
    return {
      timestamp: Date.UTC(2026, 6, 1 + index),
      open: close - 0.02,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1_000_000,
    };
  });
}

test("calculates independent structural risk and observed resistance capacity", () => {
  const assessment = assessProxMarketStructure({
    price: 12,
    vwap: 11.5,
    windowHighPrice: 12.1,
    pullbackFromWindowHighPercent: 0.8,
    acceleration5m: 2,
    averageBarRangePercent: 1,
    dailyBars: bars(60, 8, 0.05),
    intradayBars: bars(30, 11, 0.03),
  });
  assert.equal(assessment.measurable, true);
  assert.ok((assessment.structuralRiskPercent ?? 0) > 0);
  assert.ok((assessment.continuationCapacityPercent ?? 0) > 0);
  assert.ok((assessment.scenarioRiskReward ?? 0) > 0);
});

test("marks real price discovery without inventing a resistance target", () => {
  const assessment = assessProxMarketStructure({
    price: 20,
    vwap: 18.5,
    windowHighPrice: 20,
    pullbackFromWindowHighPercent: 0,
    acceleration5m: 3,
    averageBarRangePercent: 1,
    dailyBars: bars(60, 5, 0.1),
    intradayBars: bars(30, 17, 0.1),
  });
  assert.equal(assessment.priceDiscovery, true);
  assert.equal(assessment.resistancePrice, null);
  assert.ok((assessment.continuationCapacityPercent ?? 0) > 0);
});

test("withholds structure when history cannot measure ATR and invalidation", () => {
  const assessment = assessProxMarketStructure({
    price: 10,
    vwap: null,
    windowHighPrice: 10,
    pullbackFromWindowHighPercent: 0,
    acceleration5m: 0,
    averageBarRangePercent: null,
    dailyBars: bars(4),
    intradayBars: [],
  });
  assert.equal(assessment.measurable, false);
  assert.equal(assessment.scenarioRiskReward, null);
});

test("confirms post-peak failure only with volatility-adjusted damage below VWAP", () => {
  const failed = assessProxMarketStructure({
    price: 10,
    vwap: 10.5,
    windowHighPrice: 12,
    pullbackFromWindowHighPercent: 16.7,
    acceleration5m: -2,
    averageBarRangePercent: 1.5,
    dailyBars: bars(60, 7, 0.04),
    intradayBars: bars(30, 8.5, 0.03),
  });
  const recovering = assessProxMarketStructure({
    price: 10.7,
    vwap: 10.5,
    windowHighPrice: 12,
    pullbackFromWindowHighPercent: 10.8,
    acceleration5m: 2,
    averageBarRangePercent: 1.5,
    dailyBars: bars(60, 7, 0.04),
    intradayBars: bars(30, 8.5, 0.03),
  });
  assert.equal(failed.postPeakFailure, true);
  assert.equal(recovering.postPeakFailure, false);
});
