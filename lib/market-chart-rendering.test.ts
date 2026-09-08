import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildMarketChartRenderFrame, getIncrementalMarketChartStart, resolveMarketChartPriceResolution } from "./market-chart-rendering.ts";
import type { MarketChartBar } from "./market-chart";

function bar(time: number, close = 10): MarketChartBar {
  return {
    time,
    open: 10,
    high: Math.max(10, close),
    low: Math.min(10, close),
    close,
    volume: 100,
  };
}

test("uses incremental updates for a revised current candle", () => {
  const previous = buildMarketChartRenderFrame({
    bars: [bar(60), bar(120)],
    intervalSeconds: 60,
  });
  const next = buildMarketChartRenderFrame({
    bars: [bar(60), bar(120, 11)],
    intervalSeconds: 60,
  });

  assert.equal(getIncrementalMarketChartStart(previous, next), 1);
});

test("uses incremental updates for a revised tail plus appended candles", () => {
  const previous = buildMarketChartRenderFrame({
    bars: [bar(60), bar(120)],
    intervalSeconds: 60,
  });
  const next = buildMarketChartRenderFrame({
    bars: [bar(60), bar(120, 11), bar(240, 12)],
    intervalSeconds: 60,
  });

  assert.equal(getIncrementalMarketChartStart(previous, next), 1);
  assert.equal(next.slots[2].bar, null);
});

test("requires full replacement when verified history changes", () => {
  const previous = buildMarketChartRenderFrame({
    bars: [bar(60), bar(120), bar(180)],
    intervalSeconds: 60,
  });
  const next = buildMarketChartRenderFrame({
    bars: [bar(60, 11), bar(120), bar(180)],
    intervalSeconds: 60,
  });

  assert.equal(getIncrementalMarketChartStart(previous, next), null);
});

test("requires full replacement when an historical indicator changes", () => {
  const bars = [bar(60), bar(120), bar(180)];
  const previous = buildMarketChartRenderFrame({
    bars,
    intervalSeconds: 60,
    indicators: {
      vwap: [
        { time: 60, value: 10 },
        { time: 120, value: 10 },
        { time: 180, value: 10 },
      ],
    },
  });
  const next = buildMarketChartRenderFrame({
    bars,
    intervalSeconds: 60,
    indicators: {
      vwap: [
        { time: 60, value: 9 },
        { time: 120, value: 10 },
        { time: 180, value: 10 },
      ],
    },
  });

  assert.equal(getIncrementalMarketChartStart(previous, next), null);
});

test("price resolution preserves sub-dollar chart and crosshair precision", () => {
  const resolution = resolveMarketChartPriceResolution([{
    time: 60,
    open: 0.12,
    high: 0.123456,
    low: 0.119876,
    close: 0.121234,
    volume: 100,
  }]);
  assert.deepEqual(resolution, { precision: 6, minMove: 0.000001 });
});

test("price resolution preserves sub-penny wicks and stays bounded", () => {
  assert.deepEqual(resolveMarketChartPriceResolution([{
    time: 60,
    open: 0.001,
    high: 0.001009,
    low: 0.000991,
    close: 0.001001,
    volume: 100,
  }]), { precision: 7, minMove: 0.0000001 });

  assert.deepEqual(resolveMarketChartPriceResolution([{
    time: 60,
    open: 0.00000000000001,
    high: 0.00000000000002,
    low: 0.00000000000001,
    close: 0.000000000000015,
    volume: 100,
  }]), { precision: 12, minMove: 0.000000000001 });
});
