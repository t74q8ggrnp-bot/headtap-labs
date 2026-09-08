import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { calculateEma, calculateEma9, calculateEma20, calculateMarketIndicators, calculateVwap } from "./market-indicators.ts";
import type { MarketChartBar } from "./market-chart";

function bar(
  timestamp: string,
  close: number,
  volume = 100,
  range = 1,
): MarketChartBar {
  return {
    time: Date.parse(timestamp) / 1_000,
    open: close,
    high: close + range,
    low: close - range,
    close,
    volume,
  };
}

test("VWAP uses HLC3 and volume weights each verified bar", () => {
  const points = calculateVwap([
    bar("2026-09-08T13:30:00.000Z", 10, 100),
    bar("2026-09-08T13:31:00.000Z", 13, 300),
  ], { resetMode: "series" });

  assert.deepEqual(points.map((point) => point.value), [10, 12.25]);
});

test("VWAP preserves honest zero-volume behavior", () => {
  const points = calculateVwap([
    bar("2026-09-08T13:30:00.000Z", 10, 0),
    bar("2026-09-08T13:31:00.000Z", 12, 100),
    bar("2026-09-08T13:32:00.000Z", 99, 0),
  ], { resetMode: "series" });

  assert.deepEqual(points.map((point) => point.value), [null, 12, 12]);
});

test("market-session VWAP resets between premarket and regular trading", () => {
  const points = calculateVwap([
    bar("2026-09-08T13:29:00.000Z", 8, 100),
    bar("2026-09-08T13:30:00.000Z", 10, 100),
    bar("2026-09-08T13:31:00.000Z", 12, 100),
  ], { resetMode: "market_session" });

  assert.deepEqual(points.map((point) => point.value), [8, 10, 11]);
});

test("EMA is null before a complete seed and then uses the standard multiplier", () => {
  const bars = [1, 2, 3, 4, 5].map((close, index) =>
    bar(`2026-09-08T13:${String(30 + index).padStart(2, "0")}:00.000Z`, close),
  );
  const points = calculateEma(bars, 3);

  assert.deepEqual(points.map((point) => point.value), [null, null, 2, 3, 4]);
});

test("EMA9 and EMA20 seed at their exact completed periods", () => {
  const bars = Array.from({ length: 21 }, (_, index) =>
    bar(`2026-09-08T${String(13 + Math.floor(index / 30)).padStart(2, "0")}:${String(30 + (index % 30)).padStart(2, "0")}:00.000Z`, index + 1),
  );
  const ema9 = calculateEma9(bars);
  const ema20 = calculateEma20(bars);

  assert.equal(ema9[7].value, null);
  assert.equal(ema9[8].value, 5);
  assert.equal(ema9[20].value, 17);
  assert.equal(ema20[18].value, null);
  assert.equal(ema20[19].value, 10.5);
  assert.equal(ema20[20].value, 11.5);
});

test("indicator bundle produces aligned VWAP, EMA9, and EMA20 series", () => {
  const bars = Array.from({ length: 20 }, (_, index) =>
    bar(`2026-09-08T13:${String(30 + index).padStart(2, "0")}:00.000Z`, 10 + index),
  );
  const indicators = calculateMarketIndicators(bars, {
    vwapResetMode: "market_session",
  });

  assert.equal(indicators.vwap.length, bars.length);
  assert.equal(indicators.ema9.length, bars.length);
  assert.equal(indicators.ema20.length, bars.length);
  assert.equal(indicators.ema20.at(-1)?.value, 19.5);
});

test("EMA rejects invalid periods instead of returning misleading values", () => {
  assert.throws(() => calculateEma([], 0), RangeError);
  assert.throws(() => calculateEma([], 2.5), RangeError);
});
