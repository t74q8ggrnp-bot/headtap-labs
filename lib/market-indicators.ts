// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { easternDateString, type MarketChartBar } from "./market-chart.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { getStockMarketClock } from "./stock-market-session.ts";

export type MarketIndicatorPoint = {
  time: number;
  value: number | null;
};

export type VwapResetMode = "series" | "eastern_date" | "market_session";

function round(value: number, precision: number) {
  return Number(value.toFixed(precision));
}

function sortedUniqueBars(bars: readonly MarketChartBar[]) {
  const unique = new Map<number, MarketChartBar>();
  for (const bar of bars) unique.set(bar.time, { ...bar });
  return [...unique.values()].sort((left, right) => left.time - right.time);
}

function vwapResetKey(bar: MarketChartBar, mode: VwapResetMode) {
  if (mode === "series") return "series";
  const timestamp = bar.time * 1_000;
  const date = easternDateString(timestamp);
  if (mode === "eastern_date") return date;
  return `${date}:${getStockMarketClock(new Date(timestamp)).session}`;
}

/**
 * Calculates volume-weighted average price using HLC3. Zero-volume bars never
 * invent participation: they carry an established VWAP within the same reset
 * window, or remain null until positive volume is observed.
 */
export function calculateVwap(
  bars: readonly MarketChartBar[],
  options: { resetMode: VwapResetMode; precision?: number },
): MarketIndicatorPoint[] {
  const precision = options.precision ?? 8;
  let resetKey: string | null = null;
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return sortedUniqueBars(bars).map((bar) => {
    const nextResetKey = vwapResetKey(bar, options.resetMode);
    if (nextResetKey !== resetKey) {
      resetKey = nextResetKey;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }

    if (bar.volume > 0) {
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      cumulativePriceVolume += typicalPrice * bar.volume;
      cumulativeVolume += bar.volume;
    }

    return {
      time: bar.time,
      value: cumulativeVolume > 0
        ? round(cumulativePriceVolume / cumulativeVolume, precision)
        : null,
    };
  });
}

/**
 * Seeds EMA with the simple average of the first complete period, then applies
 * the standard multiplier 2 / (period + 1). Pre-seed points remain null rather
 * than exposing a partially initialized value.
 */
export function calculateEma(
  bars: readonly MarketChartBar[],
  period: number,
  precision = 8,
): MarketIndicatorPoint[] {
  if (!Number.isSafeInteger(period) || period <= 0) {
    throw new RangeError("EMA period must be a positive integer.");
  }

  const sorted = sortedUniqueBars(bars);
  const multiplier = 2 / (period + 1);
  let seedTotal = 0;
  let previousEma: number | null = null;

  return sorted.map((bar, index) => {
    if (index < period) seedTotal += bar.close;
    if (index < period - 1) return { time: bar.time, value: null };

    if (previousEma === null) {
      previousEma = seedTotal / period;
    } else {
      previousEma = (bar.close - previousEma) * multiplier + previousEma;
    }
    return { time: bar.time, value: round(previousEma, precision) };
  });
}

export function calculateEma9(
  bars: readonly MarketChartBar[],
  precision = 8,
) {
  return calculateEma(bars, 9, precision);
}

export function calculateEma20(
  bars: readonly MarketChartBar[],
  precision = 8,
) {
  return calculateEma(bars, 20, precision);
}

export function calculateMarketIndicators(
  bars: readonly MarketChartBar[],
  options: { vwapResetMode: VwapResetMode; precision?: number },
) {
  const precision = options.precision ?? 8;
  return {
    vwap: calculateVwap(bars, {
      resetMode: options.vwapResetMode,
      precision,
    }),
    ema9: calculateEma9(bars, precision),
    ema20: calculateEma20(bars, precision),
  };
}
