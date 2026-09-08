// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { buildUniformMarketTimeSlots, type MarketChartBar, type MarketChartTimeSlot } from "./market-chart.ts";
import type { MarketIndicatorPoint } from "./market-indicators.ts";

export type MarketChartIndicatorOverlays = {
  vwap?: readonly MarketIndicatorPoint[];
  ema9?: readonly MarketIndicatorPoint[];
  ema20?: readonly MarketIndicatorPoint[];
};

export type MarketChartIndicatorKey = keyof MarketChartIndicatorOverlays;

export type MarketChartIndicatorSlot = {
  time: number;
  value: number | null;
};

export type MarketChartRenderFrame = {
  slots: MarketChartTimeSlot[];
  indicators: Record<MarketChartIndicatorKey, MarketChartIndicatorSlot[]>;
};

export type MarketChartPriceResolution = {
  precision: number;
  minMove: number;
};

/**
 * lightweight-charts defaults to a two-decimal price scale. HT frequently
 * displays sub-dollar and sub-penny instruments, so derive one bounded price
 * resolution from the actual OHLC frame and apply it to every price series.
 */
export function resolveMarketChartPriceResolution(
  bars: readonly MarketChartBar[],
): MarketChartPriceResolution {
  const prices = bars.flatMap((bar) => [
    bar.open,
    bar.high,
    bar.low,
    bar.close,
  ]).filter((price) => Number.isFinite(price) && price > 0);
  const smallestPrice = prices.length > 0 ? Math.min(...prices) : 1;
  const precision = smallestPrice < 0.001
    ? Math.min(12, Math.ceil(-Math.log10(smallestPrice)) + 3)
    : smallestPrice < 1
      ? 6
      : 4;
  return {
    precision,
    minMove: 10 ** -precision,
  };
}

function buildIndicatorSlots(
  slots: readonly MarketChartTimeSlot[],
  points: readonly MarketIndicatorPoint[] | undefined,
) {
  if (!points) return [];
  const values = new Map(points.map((point) => [point.time, point.value]));
  return slots.map((slot) => {
    const value = values.get(slot.time);
    return {
      time: slot.time,
      value: Number.isFinite(value) ? value! : null,
    };
  });
}

export function buildMarketChartRenderFrame(input: {
  bars: readonly MarketChartBar[];
  intervalSeconds: number;
  indicators?: MarketChartIndicatorOverlays;
}): MarketChartRenderFrame {
  const slots = buildUniformMarketTimeSlots(
    [...input.bars],
    input.intervalSeconds,
  );
  return {
    slots,
    indicators: {
      vwap: buildIndicatorSlots(slots, input.indicators?.vwap),
      ema9: buildIndicatorSlots(slots, input.indicators?.ema9),
      ema20: buildIndicatorSlots(slots, input.indicators?.ema20),
    },
  };
}

function sameBar(
  left: MarketChartBar | null,
  right: MarketChartBar | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.time === right.time &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume;
}

function sameFramePoint(
  previous: MarketChartRenderFrame,
  next: MarketChartRenderFrame,
  index: number,
) {
  const previousSlot = previous.slots[index];
  const nextSlot = next.slots[index];
  if (
    !previousSlot ||
    !nextSlot ||
    previousSlot.time !== nextSlot.time ||
    !sameBar(previousSlot.bar, nextSlot.bar)
  ) {
    return false;
  }

  return (["vwap", "ema9", "ema20"] as const).every((key) => {
    const previousIndicator = previous.indicators[key][index];
    const nextIndicator = next.indicators[key][index];
    if (!previousIndicator && !nextIndicator) return true;
    return previousIndicator?.time === nextIndicator?.time &&
      previousIndicator?.value === nextIndicator?.value;
  });
}

/**
 * Returns the first tail index that can be safely sent through series.update.
 * Historical insertions, removals, or rewrites require a full setData reset.
 */
export function getIncrementalMarketChartStart(
  previous: MarketChartRenderFrame | null,
  next: MarketChartRenderFrame,
) {
  if (!previous || previous.slots.length === 0 || next.slots.length === 0) {
    return null;
  }
  if (next.slots.length < previous.slots.length) return null;

  const stablePrefixLength = Math.max(0, previous.slots.length - 1);
  for (let index = 0; index < stablePrefixLength; index += 1) {
    if (!sameFramePoint(previous, next, index)) return null;
  }

  const previousTail = previous.slots.at(-1);
  const nextPreviousTail = next.slots[previous.slots.length - 1];
  if (!previousTail || previousTail.time !== nextPreviousTail?.time) return null;
  return previous.slots.length - 1;
}
