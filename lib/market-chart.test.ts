import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildUniformMarketTimeSlots, easternDateString, mergeMarketBars, normalizeMarketBars, rollupMarketBars, selectLatestEasternSessionBars, summarizeMarketBars } from "./market-chart.ts";

test("normalizes, validates, orders, and deduplicates provider bars", () => {
  const bars = normalizeMarketBars([
    { time: 2_000_000_000_000, open: 11, high: 12, low: 10, close: 11.5, volume: 4 },
    { time: 1_000_000_000_000, open: 10, high: 11, low: 9, close: 10.5, volume: 3 },
    { time: 1_000_000_000, open: 10, high: 11, low: 9, close: 10.75, volume: 5 },
    { time: 3_000_000_000_000, open: 10, high: 9, low: 8, close: 10, volume: 2 },
    { time: 4_000_000_000_000, open: 0, high: 1, low: 1, close: 1, volume: 2 },
  ]);

  assert.deepEqual(bars.map((bar) => bar.time), [1_000_000_000, 2_000_000_000]);
  assert.equal(bars[0].close, 10.75);
});

test("selects only bars from the most recent Eastern market date", () => {
  const bars = normalizeMarketBars([
    { time: Date.parse("2026-08-21T19:59:00Z"), open: 4, high: 4.2, low: 3.9, close: 4.1, volume: 10 },
    { time: Date.parse("2026-08-24T12:00:00Z"), open: 5, high: 5.2, low: 4.9, close: 5.1, volume: 20 },
    { time: Date.parse("2026-08-24T12:01:00Z"), open: 5.1, high: 5.4, low: 5, close: 5.3, volume: 30 },
  ]);

  assert.equal(easternDateString(bars[0].time * 1_000), "2026-08-21");
  assert.equal(selectLatestEasternSessionBars(bars).length, 2);
});

test("computes chart summary from the displayed backend bars", () => {
  const bars = normalizeMarketBars([
    { time: 1_000, open: 10, high: 11, low: 9.5, close: 10.5, volume: 10 },
    { time: 2_000, open: 10.5, high: 13, low: 10, close: 12, volume: 20 },
  ]);
  assert.deepEqual(summarizeMarketBars(bars), {
    open: 10,
    high: 13,
    low: 9.5,
    close: 12,
    changePercent: 20,
  });
});

test("second aggregates roll into an honest current-minute candle", () => {
  const seconds = normalizeMarketBars([
    { time: 1_700_000_001, open: 10, high: 10.2, low: 9.9, close: 10.1, volume: 100 },
    { time: 1_700_000_020, open: 10.1, high: 10.4, low: 10, close: 10.3, volume: 250 },
  ]);
  const [minute] = rollupMarketBars(seconds);
  assert.equal(minute.open, 10);
  assert.equal(minute.high, 10.4);
  assert.equal(minute.low, 9.9);
  assert.equal(minute.close, 10.3);
  assert.equal(minute.volume, 350);
});

test("real-time rolled candles replace the same minute from the minute feed", () => {
  const base = normalizeMarketBars([
    { time: 1_700_000_000, open: 10, high: 10.1, low: 9.9, close: 10, volume: 20 },
  ]);
  const live = [{ ...base[0], high: 10.5, close: 10.4, volume: 100 }];
  const merged = mergeMarketBars(base, live);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].close, 10.4);
  assert.equal(merged[0].volume, 100);
});

test("builds an honest uniform time axis without fabricating missing candles", () => {
  const bars = normalizeMarketBars([
    { time: 1_700_000_000, open: 10, high: 11, low: 9, close: 10.5, volume: 20 },
    { time: 1_700_000_180, open: 12, high: 13, low: 11, close: 12.5, volume: 30 },
  ]);
  const slots = buildUniformMarketTimeSlots(bars, 60);

  assert.deepEqual(slots.map((slot) => slot.time), [
    1_699_999_980,
    1_700_000_040,
    1_700_000_100,
    1_700_000_160,
  ]);
  assert.equal(slots.filter((slot) => slot.bar !== null).length, 2);
  assert.equal(slots[1].bar, null);
  assert.equal(slots[2].bar, null);
});
