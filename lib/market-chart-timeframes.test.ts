import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { FUTURE_MARKET_CHART_TIMEFRAMES, MARKET_CHART_TIMEFRAME_CATALOG, PHASE_ONE_MARKET_CHART_TIMEFRAMES, deriveMarketChartTimeframeBars, isMarketChartTimeframe, marketSessionIsDisplayed, mergeSharedDisplayPriceIntoCurrentCandle } from "./market-chart-timeframes.ts";
import type { MarketChartBar } from "./market-chart";

function bar(
  timestamp: string,
  values: Partial<Omit<MarketChartBar, "time">> = {},
): MarketChartBar {
  return {
    time: Date.parse(timestamp) / 1_000,
    open: 10,
    high: 10.5,
    low: 9.5,
    close: 10,
    volume: 100,
    ...values,
  };
}

test("Phase 1 exposes only 1m, 5m, and 15m while preserving future metadata", () => {
  assert.deepEqual(
    PHASE_ONE_MARKET_CHART_TIMEFRAMES.map(({ id, intervalSeconds }) => ({
      id,
      intervalSeconds,
    })),
    [
      { id: "1m", intervalSeconds: 60 },
      { id: "5m", intervalSeconds: 300 },
      { id: "15m", intervalSeconds: 900 },
    ],
  );
  assert.equal(isMarketChartTimeframe("15m"), true);
  assert.equal(isMarketChartTimeframe("30m"), false);
  assert.deepEqual(
    FUTURE_MARKET_CHART_TIMEFRAMES.map(({ id, dataFamily }) => ({
      id,
      dataFamily,
    })),
    [
      { id: "30m", dataFamily: "intraday_minute" },
      { id: "1h", dataFamily: "intraday_minute" },
      { id: "1d", dataFamily: "daily" },
    ],
  );
  assert.equal(MARKET_CHART_TIMEFRAME_CATALOG.length, 6);
  assert.equal(marketSessionIsDisplayed("regular", "regular"), true);
  assert.equal(marketSessionIsDisplayed("after_hours", "regular"), false);
  assert.equal(marketSessionIsDisplayed("after_hours", "extended"), true);
});

test("derives exact five-minute OHLCV without mutating the minute base", () => {
  const input = [
    bar("2026-09-08T13:30:00.000Z", {
      open: 10,
      high: 10.4,
      low: 9.9,
      close: 10.2,
      volume: 100,
    }),
    bar("2026-09-08T13:31:00.000Z", {
      open: 10.2,
      high: 10.8,
      low: 10.1,
      close: 10.6,
      volume: 200,
    }),
    bar("2026-09-08T13:34:00.000Z", {
      open: 10.6,
      high: 10.7,
      low: 10,
      close: 10.1,
      volume: 300,
    }),
  ];
  const original = structuredClone(input);
  const [rolled] = deriveMarketChartTimeframeBars(input, "5m");

  assert.deepEqual(rolled, {
    time: Date.parse("2026-09-08T13:30:00.000Z") / 1_000,
    open: 10,
    high: 10.8,
    low: 9.9,
    close: 10.1,
    volume: 600,
  });
  assert.deepEqual(input, original);
});

test("rollups preserve a missing interval as a gap instead of forward-filling", () => {
  const rolled = deriveMarketChartTimeframeBars([
    bar("2026-09-08T13:30:00.000Z"),
    bar("2026-09-08T13:40:00.000Z"),
  ], "5m");

  assert.deepEqual(
    rolled.map((candidate) => candidate.time),
    [
      Date.parse("2026-09-08T13:30:00.000Z") / 1_000,
      Date.parse("2026-09-08T13:40:00.000Z") / 1_000,
    ],
  );
});

test("fifteen-minute rollups stay on deterministic interval boundaries", () => {
  const rolled = deriveMarketChartTimeframeBars([
    bar("2026-09-08T13:30:00.000Z", { open: 9, close: 10 }),
    bar("2026-09-08T13:44:00.000Z", { high: 12, close: 11 }),
    bar("2026-09-08T13:45:00.000Z", { open: 11, close: 10.5 }),
  ], "15m");

  assert.equal(rolled.length, 2);
  assert.deepEqual(rolled.map((candidate) => candidate.time), [
    Date.parse("2026-09-08T13:30:00.000Z") / 1_000,
    Date.parse("2026-09-08T13:45:00.000Z") / 1_000,
  ]);
  assert.equal(rolled[0].open, 9);
  assert.equal(rolled[0].close, 11);
  assert.equal(rolled[0].high, 12);
});

test("a premarket display price cannot mutate a regular-session candle", () => {
  const existing = [bar("2026-09-08T13:30:00.000Z")];
  const result = mergeSharedDisplayPriceIntoCurrentCandle({
    bars: existing,
    timeframe: "1m",
    displayedSession: "regular",
    update: {
      price: 11,
      providerTimestamp: "2026-09-08T13:28:30.000Z",
      providerSession: "pre_market",
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "displayed_session_mismatch");
  assert.equal(result.providerTimestamp, "2026-09-08T13:28:30.000Z");
  assert.equal(
    result.candleIntervalTimestamp,
    Date.parse("2026-09-08T13:28:00.000Z") / 1_000,
  );
  assert.equal(result.providerSession, "pre_market");
  assert.deepEqual(result.bars, existing);
});

test("a regular-session shared price updates only its provider-time candle", () => {
  const result = mergeSharedDisplayPriceIntoCurrentCandle({
    bars: [bar("2026-09-08T13:30:00.000Z")],
    timeframe: "5m",
    displayedSession: "regular",
    update: {
      price: 10.75,
      providerTimestamp: "2026-09-08T13:34:51.123Z",
      providerSession: "regular",
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.reason, "applied");
  assert.equal(result.bars[0].close, 10.75);
  assert.equal(result.bars[0].high, 10.75);
  assert.equal(result.bars[0].volume, 100);
  assert.equal(
    result.candleIntervalTimestamp,
    Date.parse("2026-09-08T13:30:00.000Z") / 1_000,
  );
});

test("a later same-session trade appends one provisional candle without filling gaps", () => {
  const result = mergeSharedDisplayPriceIntoCurrentCandle({
    bars: [bar("2026-09-08T13:30:00.000Z")],
    timeframe: "5m",
    displayedSession: "regular",
    update: {
      price: 10.9,
      providerTimestamp: "2026-09-08T13:42:10.000Z",
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.bars.length, 2);
  assert.deepEqual(result.bars[1], {
    time: Date.parse("2026-09-08T13:40:00.000Z") / 1_000,
    open: 10.9,
    high: 10.9,
    low: 10.9,
    close: 10.9,
    volume: 0,
  });
});

test("current-price deltas do not bridge a retained last-session chart", () => {
  const result = mergeSharedDisplayPriceIntoCurrentCandle({
    bars: [bar("2026-09-04T19:59:00.000Z")],
    timeframe: "1m",
    displayedSession: "regular",
    update: {
      price: 10.9,
      providerTimestamp: "2026-09-08T13:30:10.000Z",
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "different_session_date");
  assert.equal(result.bars.length, 1);
});

test("an older provider-time update cannot rewrite a newer candle", () => {
  const result = mergeSharedDisplayPriceIntoCurrentCandle({
    bars: [bar("2026-09-08T13:35:00.000Z")],
    timeframe: "1m",
    displayedSession: "regular",
    update: {
      price: 9,
      providerTimestamp: "2026-09-08T13:34:59.000Z",
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "out_of_order");
  assert.equal(result.bars[0].close, 10);
});

test("an explicit provider session label must agree with provider time", () => {
  const result = mergeSharedDisplayPriceIntoCurrentCandle({
    bars: [bar("2026-09-08T13:30:00.000Z")],
    timeframe: "1m",
    displayedSession: "regular",
    update: {
      price: 11,
      providerTimestamp: "2026-09-08T13:30:30.000Z",
      providerSession: "pre_market",
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "provider_session_mismatch");
});
