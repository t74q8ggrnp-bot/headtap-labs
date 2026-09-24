import type { MarketChartBar, MarketChartDisplayQuote } from "../market-chart";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { calculateMarketIndicators } from "../market-indicators.ts";

export const HT_AGENT_MARKET_ANALYSIS_VERSION = "ht-agent-market-analysis-v1" as const;

export type HtAgentMarketAnalysis = {
  version: typeof HT_AGENT_MARKET_ANALYSIS_VERSION;
  state: "strengthening" | "weakening" | "mixed" | "limited";
  headline: string;
  explanation: string;
  price: number;
  asOf: string;
  vwap: number | null;
  ema9: number | null;
  observedHigh: number;
  observedLow: number;
  rangePositionPercent: number | null;
  barCount: number;
};

function lastValue(points: Array<{ value: number | null }>) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function earlierValue(points: Array<{ value: number | null }>, completedValuesBack: number) {
  let remaining = completedValuesBack;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (remaining <= 1) return value;
    remaining -= 1;
  }
  return null;
}

function rounded(value: number, precision = 4) {
  return Number(value.toFixed(precision));
}

/**
 * Builds a descriptive, read-only market receipt from the exact chart frame.
 * This deliberately has no score, target, entry, stop, eligibility, Paper, or
 * execution field. It is market context and cannot become an Agent plan.
 */
export function deriveHtAgentMarketAnalysis(input: {
  bars: readonly MarketChartBar[];
  quote: MarketChartDisplayQuote | null;
}): HtAgentMarketAnalysis | null {
  const bars = [...input.bars]
    .filter((bar) => Number.isFinite(bar.time) && bar.close > 0)
    .sort((left, right) => left.time - right.time);
  const latestBar = bars.at(-1);
  const price = input.quote?.price ?? latestBar?.close ?? null;
  const asOf = input.quote?.asOf ?? (latestBar ? new Date(latestBar.time * 1_000).toISOString() : null);
  if (!latestBar || price === null || !(price > 0) || !asOf) return null;

  const observedHigh = Math.max(...bars.map((bar) => bar.high));
  const observedLow = Math.min(...bars.map((bar) => bar.low));
  const observedRange = observedHigh - observedLow;
  const indicators = calculateMarketIndicators(bars, {
    vwapResetMode: "eastern_date",
    precision: 8,
  });
  const vwap = lastValue(indicators.vwap);
  const ema9 = lastValue(indicators.ema9);
  const priorEma9 = earlierValue(indicators.ema9, 4);
  const emaRising = ema9 !== null && priorEma9 !== null && ema9 > priorEma9;
  const emaFalling = ema9 !== null && priorEma9 !== null && ema9 < priorEma9;
  const aboveVwap = vwap !== null && price > vwap;
  const belowVwap = vwap !== null && price < vwap;
  const aboveEma = ema9 !== null && price > ema9;
  const belowEma = ema9 !== null && price < ema9;
  const limited = bars.length < 12 || vwap === null || ema9 === null;

  let state: HtAgentMarketAnalysis["state"] = "mixed";
  let headline = "Mixed intraday structure";
  let explanation = "Price and the measured intraday references are not aligned in one direction.";
  if (limited) {
    state = "limited";
    headline = "Limited verified tape";
    explanation = "The provider frame is valid, but it does not yet contain enough traded intervals for a stronger market read.";
  } else if (aboveVwap && aboveEma && emaRising) {
    state = "strengthening";
    headline = "Holding above VWAP with rising short-term structure";
    explanation = "Price is above both measured references and the 9-period average is rising. This is context, not an entry signal.";
  } else if (belowVwap && belowEma && emaFalling) {
    state = "weakening";
    headline = "Trading below VWAP with weakening short-term structure";
    explanation = "Price is below both measured references and the 9-period average is falling. This is context, not an exit signal.";
  } else if (aboveVwap && aboveEma) {
    headline = "Above VWAP and EMA 9 with mixed slope";
    explanation = "Price is above both measured references, while short-term direction is not yet consistently rising.";
  } else if (belowVwap && belowEma) {
    headline = "Below VWAP and EMA 9 with mixed slope";
    explanation = "Price is below both measured references, while short-term direction is not yet consistently falling.";
  }

  return {
    version: HT_AGENT_MARKET_ANALYSIS_VERSION,
    state,
    headline,
    explanation,
    price: rounded(price),
    asOf,
    vwap: vwap === null ? null : rounded(vwap),
    ema9: ema9 === null ? null : rounded(ema9),
    observedHigh: rounded(observedHigh),
    observedLow: rounded(observedLow),
    rangePositionPercent: observedRange > 0
      ? rounded(Math.max(0, Math.min(100, ((price - observedLow) / observedRange) * 100)), 1)
      : null,
    barCount: bars.length,
  };
}
