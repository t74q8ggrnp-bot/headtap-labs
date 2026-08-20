export const PROX_MARKET_STRUCTURE_VERSION =
  "prox-market-structure-v1";

export type ProxStructureBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ProxMarketStructureInput = {
  price: number;
  vwap: number | null;
  windowHighPrice: number | null;
  pullbackFromWindowHighPercent: number | null;
  acceleration5m: number | null;
  averageBarRangePercent: number | null;
  dailyBars: ProxStructureBar[];
  intradayBars: ProxStructureBar[];
};

export type ProxMarketStructureAssessment = {
  version: typeof PROX_MARKET_STRUCTURE_VERSION;
  atr14: number | null;
  atrPercent: number | null;
  realizedIntradayRangePercent: number | null;
  dailySupport: number | null;
  intradaySwingLow: number | null;
  vwapSupport: number | null;
  structuralSupport: number | null;
  invalidationPrice: number | null;
  structuralRiskPercent: number | null;
  resistancePrice: number | null;
  priceDiscovery: boolean;
  continuationCapacityPercent: number | null;
  scenarioRiskReward: number | null;
  dailyTrendPercent: number | null;
  extensionAtrMultiple: number | null;
  extended: boolean;
  postPeakFailure: boolean;
  severePeakFailure: boolean;
  measurable: boolean;
  reasons: string[];
};

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function validBars(bars: ProxStructureBar[]) {
  return bars
    .filter(
      (bar) =>
        Number.isFinite(bar.timestamp) &&
        positive(bar.open) !== null &&
        positive(bar.high) !== null &&
        positive(bar.low) !== null &&
        positive(bar.close) !== null &&
        bar.high >= bar.low,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function atr14(bars: ProxStructureBar[]) {
  if (bars.length < 15) return null;
  const trueRanges = bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  return average(trueRanges.slice(-14));
}

function swingLevels(bars: ProxStructureBar[], side: "low" | "high") {
  const levels: number[] = [];
  for (let index = 1; index < bars.length - 1; index += 1) {
    const previous = bars[index - 1][side];
    const current = bars[index][side];
    const next = bars[index + 1][side];
    if (
      (side === "low" && current <= previous && current <= next) ||
      (side === "high" && current >= previous && current >= next)
    ) {
      levels.push(current);
    }
  }
  return levels;
}

function nearestSupport(
  price: number,
  minimumDistance: number,
  candidates: Array<number | null>,
) {
  const levels = candidates.filter(
    (candidate): candidate is number =>
      candidate !== null &&
      candidate > 0 &&
      candidate < price - minimumDistance,
  );
  return levels.length > 0 ? Math.max(...levels) : null;
}

export function assessProxMarketStructure(
  input: ProxMarketStructureInput,
): ProxMarketStructureAssessment {
  const price = positive(input.price) ?? 0;
  const dailyBars = validBars(input.dailyBars).slice(-90);
  const intradayBars = validBars(input.intradayBars).slice(-480);
  const atr = atr14(dailyBars);
  const atrPercent = price > 0 && atr !== null ? (atr / price) * 100 : null;
  const dailyLows = swingLevels(dailyBars.slice(-35), "low");
  const intradayLows = swingLevels(intradayBars.slice(-90), "low");
  const dailyHighs = swingLevels(dailyBars.slice(-60), "high");
  const fallbackDailySupport =
    dailyBars.length >= 10
      ? Math.min(...dailyBars.slice(-10).map((bar) => bar.low))
      : null;
  const fallbackIntradaySupport =
    intradayBars.length >= 5
      ? Math.min(...intradayBars.slice(-12).map((bar) => bar.low))
      : null;
  const dailySupport = nearestSupport(price, 0, [
    ...dailyLows,
    fallbackDailySupport,
  ]);
  const intradaySwingLow = nearestSupport(price, 0, [
    ...intradayLows,
    fallbackIntradaySupport,
  ]);
  const vwap = positive(input.vwap);
  const vwapSupport = vwap !== null && vwap < price ? vwap : null;
  const meaningfulDistance = Math.max(
    price * 0.005,
    atr === null ? 0 : atr * 0.25,
  );
  const structuralSupport = nearestSupport(price, meaningfulDistance, [
    vwapSupport,
    intradaySwingLow,
    dailySupport,
  ]);
  const invalidationBuffer = Math.max(
    price * 0.0025,
    atr === null ? 0 : atr * 0.15,
  );
  const invalidationPrice =
    structuralSupport === null
      ? null
      : Math.max(0.000001, structuralSupport - invalidationBuffer);
  const structuralRiskPercent =
    invalidationPrice !== null && price > invalidationPrice
      ? ((price - invalidationPrice) / price) * 100
      : null;

  const resistanceBuffer = Math.max(
    price * 0.0075,
    atr === null ? 0 : atr * 0.2,
  );
  const resistanceLevels = [
    ...dailyHighs,
    ...dailyBars.slice(-60).map((bar) => bar.high),
  ].filter((level) => level > price + resistanceBuffer);
  const resistancePrice =
    resistanceLevels.length > 0 ? Math.min(...resistanceLevels) : null;
  const priceDiscovery = price > 0 && resistancePrice === null;

  const intradayHigh =
    intradayBars.length > 0
      ? Math.max(...intradayBars.map((bar) => bar.high))
      : positive(input.windowHighPrice);
  const intradayLow =
    intradayBars.length > 0
      ? Math.min(...intradayBars.map((bar) => bar.low))
      : null;
  const realizedIntradayRangePercent =
    price > 0 && intradayHigh !== null && intradayLow !== null
      ? ((intradayHigh - intradayLow) / price) * 100
      : null;
  const continuationCapacityPercent =
    price <= 0
      ? null
      : resistancePrice !== null
        ? ((resistancePrice - price) / price) * 100
        : atrPercent !== null && realizedIntradayRangePercent !== null
          ? atrPercent * 0.8 + realizedIntradayRangePercent * 0.2
          : null;
  const scenarioRiskReward =
    continuationCapacityPercent !== null &&
    continuationCapacityPercent > 0 &&
    structuralRiskPercent !== null &&
    structuralRiskPercent > 0
      ? continuationCapacityPercent / structuralRiskPercent
      : null;

  const recentDailyCloses = dailyBars.slice(-20).map((bar) => bar.close);
  const dailyAverage = average(recentDailyCloses);
  const dailyTrendPercent =
    dailyAverage !== null && dailyAverage > 0
      ? ((price - dailyAverage) / dailyAverage) * 100
      : null;
  const extensionAtrMultiple =
    atr !== null && atr > 0 && vwap !== null
      ? (price - vwap) / atr
      : null;
  const extended =
    extensionAtrMultiple !== null && extensionAtrMultiple >= 2.5;
  const pullback = finite(input.pullbackFromWindowHighPercent);
  const averageBarRange = positive(input.averageBarRangePercent);
  const peakFailureThreshold = Math.max(
    8,
    averageBarRange === null ? 8 : averageBarRange * 5,
  );
  const postPeakFailure =
    pullback !== null &&
    pullback >= peakFailureThreshold &&
    (finite(input.acceleration5m) ?? 0) <= 0 &&
    vwap !== null &&
    price < vwap;
  // postPeakFailure only catches a breakdown while it is actively happening
  // (current 5-minute acceleration and current price-vs-VWAP). A name that
  // already failed hard and has since gone quiet -- flat or even ticking up
  // slightly, sitting above a VWAP the earlier selloff itself dragged down --
  // can pass through it untouched. This is the same volatility-adjusted
  // threshold at a much higher multiple, so it only fires on realized
  // pullback magnitude far beyond anything ambiguous, independent of the
  // current tick.
  const severePeakFailure =
    pullback !== null && pullback >= peakFailureThreshold * 2.5;
  const measurable =
    price > 0 &&
    atrPercent !== null &&
    structuralRiskPercent !== null &&
    continuationCapacityPercent !== null &&
    scenarioRiskReward !== null;

  const reasons: string[] = [];
  if (dailySupport !== null) reasons.push("Daily support was derived from adjusted observed lows.");
  if (intradaySwingLow !== null) reasons.push("A recent intraday swing low contributes to structural support.");
  if (vwapSupport !== null) reasons.push("VWAP is below price and acts as an observed support candidate.");
  if (priceDiscovery) reasons.push("No meaningful adjusted daily resistance is currently observed above price.");
  if (resistancePrice !== null) reasons.push("Continuation capacity stops at the nearest observed daily resistance.");
  if (extended) reasons.push("Price is extended by at least 2.5 ATR from live VWAP.");
  if (postPeakFailure) reasons.push("Price is below VWAP after a volatility-adjusted failure from the recent high.");
  if (severePeakFailure && !postPeakFailure) reasons.push("Realized pullback from the recent high is severe regardless of the current tick.");
  if (!measurable) reasons.push("Structure, risk, or continuation capacity cannot yet be measured honestly.");

  return {
    version: PROX_MARKET_STRUCTURE_VERSION,
    atr14: atr === null ? null : round(atr, 6),
    atrPercent: atrPercent === null ? null : round(atrPercent),
    realizedIntradayRangePercent:
      realizedIntradayRangePercent === null
        ? null
        : round(realizedIntradayRangePercent),
    dailySupport: dailySupport === null ? null : round(dailySupport, 6),
    intradaySwingLow:
      intradaySwingLow === null ? null : round(intradaySwingLow, 6),
    vwapSupport: vwapSupport === null ? null : round(vwapSupport, 6),
    structuralSupport:
      structuralSupport === null ? null : round(structuralSupport, 6),
    invalidationPrice:
      invalidationPrice === null ? null : round(invalidationPrice, 6),
    structuralRiskPercent:
      structuralRiskPercent === null ? null : round(structuralRiskPercent),
    resistancePrice:
      resistancePrice === null ? null : round(resistancePrice, 6),
    priceDiscovery,
    continuationCapacityPercent:
      continuationCapacityPercent === null
        ? null
        : round(continuationCapacityPercent),
    scenarioRiskReward:
      scenarioRiskReward === null ? null : round(scenarioRiskReward),
    dailyTrendPercent:
      dailyTrendPercent === null ? null : round(dailyTrendPercent),
    extensionAtrMultiple:
      extensionAtrMultiple === null ? null : round(extensionAtrMultiple),
    extended,
    postPeakFailure,
    severePeakFailure,
    measurable,
    reasons,
  };
}
