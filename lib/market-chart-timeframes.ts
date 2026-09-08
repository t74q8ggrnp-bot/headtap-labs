// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { easternDateString, rollupMarketBars, type MarketChartBar } from "./market-chart.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { getStockMarketClock, type StockMarketSession } from "./stock-market-session.ts";

export type MarketChartTimeframe = "1m" | "5m" | "15m";
export type FutureMarketChartTimeframe = "30m" | "1h" | "1d";
export type MarketChartTimeframeId =
  | MarketChartTimeframe
  | FutureMarketChartTimeframe;

export type MarketChartTimeframeMetadata = {
  id: MarketChartTimeframeId;
  label: string;
  intervalSeconds: number;
  availability: "phase_1" | "future";
  dataFamily: "intraday_minute" | "daily";
  derivedFrom: MarketChartTimeframe | null;
};

/**
 * Phase 1 always loads one-minute history once. Five- and fifteen-minute
 * candles are presentation rollups, so changing the chart timeframe does not
 * authorize another provider request.
 */
export const PHASE_ONE_MARKET_CHART_TIMEFRAMES = [
  {
    id: "1m",
    label: "1m",
    intervalSeconds: 60,
    availability: "phase_1",
    dataFamily: "intraday_minute",
    derivedFrom: null,
  },
  {
    id: "5m",
    label: "5m",
    intervalSeconds: 5 * 60,
    availability: "phase_1",
    dataFamily: "intraday_minute",
    derivedFrom: "1m",
  },
  {
    id: "15m",
    label: "15m",
    intervalSeconds: 15 * 60,
    availability: "phase_1",
    dataFamily: "intraday_minute",
    derivedFrom: "1m",
  },
] as const satisfies readonly MarketChartTimeframeMetadata[];

/**
 * Reserved extension points. They are metadata only and must not appear as
 * selectable Phase 1 timeframes. Daily bars intentionally use another data
 * family instead of pretending a bounded intraday bootstrap can create them.
 */
export const FUTURE_MARKET_CHART_TIMEFRAMES = [
  {
    id: "30m",
    label: "30m",
    intervalSeconds: 30 * 60,
    availability: "future",
    dataFamily: "intraday_minute",
    derivedFrom: "1m",
  },
  {
    id: "1h",
    label: "1h",
    intervalSeconds: 60 * 60,
    availability: "future",
    dataFamily: "intraday_minute",
    derivedFrom: "1m",
  },
  {
    id: "1d",
    label: "1D",
    intervalSeconds: 24 * 60 * 60,
    availability: "future",
    dataFamily: "daily",
    derivedFrom: null,
  },
] as const satisfies readonly MarketChartTimeframeMetadata[];

export const MARKET_CHART_TIMEFRAME_CATALOG = [
  ...PHASE_ONE_MARKET_CHART_TIMEFRAMES,
  ...FUTURE_MARKET_CHART_TIMEFRAMES,
] as const;

export function isMarketChartTimeframe(
  value: unknown,
): value is MarketChartTimeframe {
  return PHASE_ONE_MARKET_CHART_TIMEFRAMES.some(
    (timeframe) => timeframe.id === value,
  );
}

export function getMarketChartTimeframeMetadata(
  timeframe: MarketChartTimeframe,
): (typeof PHASE_ONE_MARKET_CHART_TIMEFRAMES)[number] {
  return PHASE_ONE_MARKET_CHART_TIMEFRAMES.find(
    (candidate) => candidate.id === timeframe,
  )!;
}

/**
 * Derives a displayed timeframe from a verified one-minute base. Empty
 * intervals remain absent; this function never forward-fills or fabricates
 * candles. The input array and its bars are not mutated.
 */
export function deriveMarketChartTimeframeBars(
  oneMinuteBars: readonly MarketChartBar[],
  timeframe: MarketChartTimeframe,
): MarketChartBar[] {
  const sorted = [...oneMinuteBars]
    .map((bar) => ({ ...bar }))
    .sort((left, right) => left.time - right.time);
  const intervalSeconds = getMarketChartTimeframeMetadata(timeframe).intervalSeconds;
  return intervalSeconds === 60
    ? sorted
    : rollupMarketBars(sorted, intervalSeconds);
}

export type MarketChartDisplayedSession =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "extended";

export type ActiveStockMarketSession = Exclude<StockMarketSession, "closed">;

export type SharedDisplayPriceUpdate = {
  price: number;
  /** The time the provider observed the trade, not a server receipt time. */
  providerTimestamp: string;
  /** Optional provider label; when present it must agree with provider time. */
  providerSession?: ActiveStockMarketSession;
};

export type CurrentCandleMergeReason =
  | "applied"
  | "invalid_price"
  | "invalid_provider_timestamp"
  | "closed_provider_session"
  | "provider_session_mismatch"
  | "displayed_session_mismatch"
  | "no_candle_context"
  | "different_session_date"
  | "out_of_order";

export type CurrentCandleMergeResult = {
  bars: MarketChartBar[];
  applied: boolean;
  reason: CurrentCandleMergeReason;
  /** Kept distinct from the interval timestamp used by the candle. */
  providerTimestamp: string;
  candleIntervalTimestamp: number | null;
  providerSession: StockMarketSession | null;
  displayedSession: MarketChartDisplayedSession;
};

export function marketSessionIsDisplayed(
  providerSession: ActiveStockMarketSession,
  displayedSession: MarketChartDisplayedSession,
) {
  return displayedSession === "extended" || providerSession === displayedSession;
}

function roundPrice(value: number, precision: number) {
  return Number(value.toFixed(precision));
}

/**
 * Applies a shared presentation price only to the provider-time candle that
 * belongs to the displayed session. For example, a 9:28 a.m. premarket print
 * cannot mutate a regular-session chart. The function also refuses to bridge
 * a last-session bootstrap into today's first candle; callers must bootstrap
 * the correct session before accepting deltas.
 */
export function mergeSharedDisplayPriceIntoCurrentCandle(input: {
  bars: readonly MarketChartBar[];
  timeframe: MarketChartTimeframe;
  displayedSession: MarketChartDisplayedSession;
  update: SharedDisplayPriceUpdate;
  pricePrecision?: number;
}): CurrentCandleMergeResult {
  const uniqueBars = new Map<number, MarketChartBar>();
  for (const bar of input.bars) uniqueBars.set(bar.time, { ...bar });
  const bars = [...uniqueBars.values()].sort(
    (left, right) => left.time - right.time,
  );
  const baseResult = {
    bars,
    applied: false,
    providerTimestamp: input.update.providerTimestamp,
    candleIntervalTimestamp: null,
    providerSession: null,
    displayedSession: input.displayedSession,
  } as const;

  if (!Number.isFinite(input.update.price) || input.update.price <= 0) {
    return { ...baseResult, reason: "invalid_price" };
  }

  const providerMs = Date.parse(input.update.providerTimestamp);
  if (!Number.isFinite(providerMs)) {
    return { ...baseResult, reason: "invalid_provider_timestamp" };
  }

  const providerClock = getStockMarketClock(new Date(providerMs));
  const intervalSeconds = getMarketChartTimeframeMetadata(
    input.timeframe,
  ).intervalSeconds;
  const candleIntervalTimestamp =
    Math.floor(providerMs / 1_000 / intervalSeconds) * intervalSeconds;
  const timedResult = {
    ...baseResult,
    candleIntervalTimestamp,
    providerSession: providerClock.session,
  };

  if (providerClock.session === "closed") {
    return { ...timedResult, reason: "closed_provider_session" };
  }
  if (
    input.update.providerSession &&
    input.update.providerSession !== providerClock.session
  ) {
    return { ...timedResult, reason: "provider_session_mismatch" };
  }
  if (!marketSessionIsDisplayed(providerClock.session, input.displayedSession)) {
    return { ...timedResult, reason: "displayed_session_mismatch" };
  }

  const latest = bars.at(-1);
  if (!latest) return { ...timedResult, reason: "no_candle_context" };

  const providerDate = easternDateString(providerMs);
  const latestDate = easternDateString(latest.time * 1_000);
  if (providerDate !== latestDate) {
    return { ...timedResult, reason: "different_session_date" };
  }
  if (candleIntervalTimestamp < latest.time) {
    return { ...timedResult, reason: "out_of_order" };
  }

  const pricePrecision = input.pricePrecision ?? 6;
  const price = roundPrice(input.update.price, pricePrecision);
  if (candleIntervalTimestamp === latest.time) {
    bars[bars.length - 1] = {
      ...latest,
      high: roundPrice(Math.max(latest.high, price), pricePrecision),
      low: roundPrice(Math.min(latest.low, price), pricePrecision),
      close: price,
    };
  } else {
    bars.push({
      time: candleIntervalTimestamp,
      open: price,
      high: price,
      low: price,
      close: price,
      // This delta is one verified print, not a complete aggregate. Keeping
      // volume at zero avoids double-counting when the provider bar arrives.
      volume: 0,
    });
  }

  return {
    ...timedResult,
    bars,
    applied: true,
    reason: "applied",
  };
}
