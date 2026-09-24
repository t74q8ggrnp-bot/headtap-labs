import type { MarketChartBar, MarketChartDisplayQuote } from "./market-chart";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { calculateMarketIndicators } from "./market-indicators.ts";

export const HT_MARKET_SCORE_VERSION = "ht-market-score-beta-v1" as const;

export type HtMarketScoreAssetKind = "stock" | "etf" | "unknown";
export type HtMarketScoreState = "strong" | "constructive" | "mixed" | "weakening" | "weak";

export type HtMarketScoreReceipt = {
  version: typeof HT_MARKET_SCORE_VERSION;
  score: number;
  state: HtMarketScoreState;
  assetKind: HtMarketScoreAssetKind;
  providerAsOf: string;
  observedPrice: number;
  barCount: number;
  components: {
    trend: number;
    participation: number;
    rangePosition: number;
    pathQuality: number;
    evidence: number;
    extensionPenalty: number;
  };
  inputs: {
    vwap: number;
    ema9: number;
    ema20: number;
    ema9SlopePercent: number;
    recentVolumeRatio: number;
    rangePositionPercent: number;
    recentPositiveCloseRatio: number;
    pullbackFromWindowHighPercent: number;
    extensionAtrUnits: number;
  };
  authority: {
    canonical: false;
    prox: false;
    agentRisk: false;
    paper: false;
    execution: false;
  };
  receiptState: "persisted";
};

export type UnpersistedHtMarketScore = Omit<HtMarketScoreReceipt, "receiptState">;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision = 4) {
  return Number(value.toFixed(precision));
}

function lastValue(points: Array<{ value: number | null }>) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function valueBack(points: Array<{ value: number | null }>, completedValuesBack: number) {
  let remaining = completedValuesBack;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (remaining <= 1) return value;
    remaining -= 1;
  }
  return null;
}

function stateForScore(score: number): HtMarketScoreState {
  if (score >= 80) return "strong";
  if (score >= 65) return "constructive";
  if (score >= 45) return "mixed";
  if (score >= 30) return "weakening";
  return "weak";
}

/**
 * A descriptive market-structure score, not an opportunity score. The same
 * frozen formula is evaluated for stocks and ETFs, while outcomes are kept in
 * separate cohorts. It has no Canonical, ProX, Agent, Paper, or execution
 * authority.
 */
export function calculateHtMarketScore(input: {
  bars: readonly MarketChartBar[];
  quote: MarketChartDisplayQuote | null;
  assetKind: HtMarketScoreAssetKind;
}): UnpersistedHtMarketScore | null {
  const bars = [...input.bars]
    .filter((bar) => Number.isFinite(bar.time) && bar.close > 0 && bar.volume >= 0)
    .sort((left, right) => left.time - right.time);
  const latest = bars.at(-1);
  const price = input.quote?.price ?? latest?.close ?? null;
  const providerAsOf = input.quote?.asOf ?? (latest ? new Date(latest.time * 1_000).toISOString() : null);
  if (!latest || bars.length < 20 || price === null || !(price > 0) || !providerAsOf) return null;

  const indicators = calculateMarketIndicators(bars, {
    vwapResetMode: "eastern_date",
    precision: 8,
  });
  const vwap = lastValue(indicators.vwap);
  const ema9 = lastValue(indicators.ema9);
  const ema20 = lastValue(indicators.ema20);
  const priorEma9 = valueBack(indicators.ema9, 5);
  if (vwap === null || ema9 === null || ema20 === null || priorEma9 === null) return null;

  const recent = bars.slice(-15);
  const priorVolumeWindow = bars.slice(-35, -5);
  const recentVolumeWindow = bars.slice(-5);
  const average = (values: number[]) => values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
  const recentVolume = average(recentVolumeWindow.map((bar) => bar.volume));
  const priorVolume = average(priorVolumeWindow.map((bar) => bar.volume));
  const recentVolumeRatio = priorVolume > 0 ? recentVolume / priorVolume : 0;
  const recentPositiveCloseRatio = recent.length > 1
    ? recent.slice(1).filter((bar, index) => bar.close >= recent[index].close).length / (recent.length - 1)
    : 0;
  const observedHigh = Math.max(...bars.map((bar) => bar.high));
  const observedLow = Math.min(...bars.map((bar) => bar.low));
  const observedRange = observedHigh - observedLow;
  const rangePosition = observedRange > 0 ? clamp((price - observedLow) / observedRange, 0, 1) : 0.5;
  const pullback = observedHigh > 0 ? Math.max(0, ((observedHigh - price) / observedHigh) * 100) : 0;
  const trueRanges = bars.slice(-15).map((bar, index, window) => {
    const priorClose = index > 0 ? window[index - 1].close : bar.open;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - priorClose), Math.abs(bar.low - priorClose));
  });
  const averageTrueRange = average(trueRanges);
  const extensionAtrUnits = averageTrueRange > 0 ? Math.abs(price - vwap) / averageTrueRange : 0;
  const ema9SlopePercent = priorEma9 > 0 ? ((ema9 - priorEma9) / priorEma9) * 100 : 0;

  const trend = clamp(
    (price >= vwap ? 8 : 0) +
    (price >= ema9 ? 6 : 0) +
    (ema9 >= ema20 ? 8 : 0) +
    clamp(3 + ema9SlopePercent * 6, 0, 8),
    0,
    30,
  );
  const participation = clamp(recentVolumeRatio * 10, 0, 20);
  const rangePositionScore = rangePosition * 15;
  const pathQuality = clamp(
    recentPositiveCloseRatio * 10 + clamp(10 - pullback * 1.25, 0, 10),
    0,
    20,
  );
  const evidence = clamp((bars.length / 120) * 10, 0, 10) + (input.quote?.live ? 5 : 2);
  const extensionPenalty = extensionAtrUnits <= 2
    ? 0
    : clamp((extensionAtrUnits - 2) * 4, 0, 15);
  const score = Math.round(clamp(
    trend + participation + rangePositionScore + pathQuality + evidence - extensionPenalty,
    0,
    100,
  ));

  return {
    version: HT_MARKET_SCORE_VERSION,
    score,
    state: stateForScore(score),
    assetKind: input.assetKind,
    providerAsOf,
    observedPrice: round(price),
    barCount: bars.length,
    components: {
      trend: round(trend, 2),
      participation: round(participation, 2),
      rangePosition: round(rangePositionScore, 2),
      pathQuality: round(pathQuality, 2),
      evidence: round(evidence, 2),
      extensionPenalty: round(extensionPenalty, 2),
    },
    inputs: {
      vwap: round(vwap),
      ema9: round(ema9),
      ema20: round(ema20),
      ema9SlopePercent: round(ema9SlopePercent),
      recentVolumeRatio: round(recentVolumeRatio),
      rangePositionPercent: round(rangePosition * 100, 2),
      recentPositiveCloseRatio: round(recentPositiveCloseRatio, 4),
      pullbackFromWindowHighPercent: round(pullback, 4),
      extensionAtrUnits: round(extensionAtrUnits, 4),
    },
    authority: {
      canonical: false,
      prox: false,
      agentRisk: false,
      paper: false,
      execution: false,
    },
  };
}

export function validHtMarketScoreReceipt(value: unknown): value is HtMarketScoreReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<HtMarketScoreReceipt>;
  const components = receipt.components as Record<string, unknown> | undefined;
  const inputs = receipt.inputs as Record<string, unknown> | undefined;
  const finite = (record: Record<string, unknown> | undefined, keys: string[]) =>
    Boolean(record) && keys.every((key) => Number.isFinite(record?.[key]));
  return receipt.version === HT_MARKET_SCORE_VERSION &&
    Number.isInteger(receipt.score) && Number(receipt.score) >= 0 && Number(receipt.score) <= 100 &&
    ["strong", "constructive", "mixed", "weakening", "weak"].includes(String(receipt.state)) &&
    ["stock", "etf", "unknown"].includes(String(receipt.assetKind)) &&
    Number.isFinite(Date.parse(String(receipt.providerAsOf ?? ""))) &&
    Number.isFinite(receipt.observedPrice) && Number(receipt.observedPrice) > 0 &&
    Number.isInteger(receipt.barCount) && Number(receipt.barCount) >= 20 && Number(receipt.barCount) <= 1_000 &&
    finite(components, ["trend", "participation", "rangePosition", "pathQuality", "evidence", "extensionPenalty"]) &&
    finite(inputs, ["vwap", "ema9", "ema20", "ema9SlopePercent", "recentVolumeRatio", "rangePositionPercent", "recentPositiveCloseRatio", "pullbackFromWindowHighPercent", "extensionAtrUnits"]) &&
    receipt.receiptState === "persisted" &&
    receipt.authority?.canonical === false && receipt.authority.prox === false &&
    receipt.authority.agentRisk === false && receipt.authority.paper === false &&
    receipt.authority.execution === false;
}
