import type {
  CryptoOpportunity,
  CryptoProxPacket,
} from "@/lib/crypto/contracts";

export const CRYPTO_PROX_VERSION = "crypto-prox-v2" as const;
export const CRYPTO_PROX_MODE = "bounded_authority" as const;

// Coinbase publishes closed 1-minute candles, not a live in-progress one, and
// how far the latest closed candle trails "now" varies by product and by
// when in the current minute it's queried -- measured directly up to ~120s
// under completely normal conditions, for major pairs, not just thin ones.
// 180s left too little margin above that real variance. ProX evaluates the
// crypto board every 5 minutes, so "fresh" matching that cadence is the
// natural bar -- tighter than how often we actually look doesn't buy
// anything.
const CRYPTO_PULSE_FRESH_SECONDS = 300;

export type CryptoMinuteCandle = {
  time: number;
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
};

export type CryptoTopOfBook = {
  price: number;
  bid: number;
  ask: number;
  time: string | null;
};

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

const round = (value: number, precision = 3) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

function percentChange(current: number, prior: number) {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}

function changeAtLookback(candles: CryptoMinuteCandle[], minutes: number) {
  if (candles.length <= minutes) return null;
  return percentChange(
    candles.at(-1)!.close,
    candles[candles.length - 1 - minutes].close,
  );
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function finiteOrNull(value: number | null, precision = 3) {
  return value !== null && Number.isFinite(value)
    ? round(value, precision)
    : null;
}

function normalizeMinuteCandles(
  candles: CryptoMinuteCandle[],
  windowMinutes = 60,
) {
  const sorted = [...candles]
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        candle.time > 0 &&
        Number.isFinite(candle.close) &&
        candle.close > 0,
    )
    .sort((left, right) => left.time - right.time);
  const latest = sorted.at(-1);
  if (!latest) return [];
  const startTime = latest.time - (windowMinutes - 1) * 60;
  const byTime = new Map(sorted.map((candle) => [candle.time, candle]));
  let previous = [...sorted].reverse().find((candle) => candle.time <= startTime);
  const normalized: CryptoMinuteCandle[] = [];
  for (let time = startTime; time <= latest.time; time += 60) {
    const observed = byTime.get(time);
    if (observed) {
      previous = observed;
      normalized.push(observed);
      continue;
    }
    if (!previous) continue;
    normalized.push({
      time,
      low: previous.close,
      high: previous.close,
      open: previous.close,
      close: previous.close,
      volume: 0,
    });
  }
  return normalized;
}

export function buildCryptoProxPacket({
  opportunity,
  candles,
  benchmarkCandles,
  quote,
  now = new Date(),
}: {
  opportunity: CryptoOpportunity;
  candles: CryptoMinuteCandle[];
  benchmarkCandles: CryptoMinuteCandle[];
  quote: CryptoTopOfBook | null;
  now?: Date;
}): CryptoProxPacket {
  const sourceCandles = [...candles]
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        candle.time > 0 &&
        Number.isFinite(candle.close) &&
        candle.close > 0,
    )
    .sort((left, right) => left.time - right.time);
  const orderedCandles = normalizeMinuteCandles(sourceCandles);
  const normalizedBenchmarkCandles = normalizeMinuteCandles(benchmarkCandles);
  const latest = orderedCandles.at(-1) ?? null;
  const latestObserved = sourceCandles.at(-1) ?? null;
  const latestBucketEndMs = latestObserved
    ? (latestObserved.time + 60) * 1_000
    : 0;
  const ageSeconds = latestBucketEndMs > 0
    ? Math.max(0, Math.round((now.getTime() - latestBucketEndMs) / 1_000))
    : Infinity;
  const fresh = ageSeconds <= CRYPTO_PULSE_FRESH_SECONDS;
  const velocity1m = changeAtLookback(orderedCandles, 1);
  const velocity5m = changeAtLookback(orderedCandles, 5);
  const velocity15m = changeAtLookback(orderedCandles, 15);

  const recentBars = orderedCandles.slice(-30);
  const latestVolumes = recentBars.slice(-3).map((candle) => candle.volume);
  const baselineVolumes = recentBars.slice(0, -3).map((candle) => candle.volume);
  const recentAverageVolume = latestVolumes.length > 0
    ? latestVolumes.reduce((sum, value) => sum + value, 0) /
      latestVolumes.length
    : 0;
  const baselineAverageVolume = baselineVolumes.length > 0
    ? baselineVolumes.reduce((sum, value) => sum + value, 0) /
      baselineVolumes.length
    : 0;
  const volumeAcceleration = baselineAverageVolume > 0
    ? recentAverageVolume / baselineAverageVolume
    : null;
  const totalVolume = recentBars.reduce((sum, candle) => sum + candle.volume, 0);
  const vwap = totalVolume > 0
    ? recentBars.reduce(
        (sum, candle) =>
          sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume,
        0,
      ) / totalVolume
    : null;
  const currentPrice = quote?.price && quote.price > 0
    ? quote.price
    : opportunity.price;
  const priceVsVwap = vwap && vwap > 0
    ? ((currentPrice - vwap) / vwap) * 100
    : null;
  const peak = recentBars.length > 0
    ? recentBars.reduce(
        (highest, candle) => candle.high >= highest.high ? candle : highest,
        recentBars[0],
      )
    : null;
  const windowHighPrice = peak?.high ?? null;
  const pullbackFromWindowHigh = windowHighPrice && windowHighPrice > 0
    ? Math.max(0, ((windowHighPrice - currentPrice) / windowHighPrice) * 100)
    : null;
  const minutesSinceWindowHigh = peak && latest
    ? Math.max(0, (latest.time - peak.time) / 60)
    : null;
  const averageBarRange = recentBars.length > 0
    ? recentBars.reduce(
        (sum, candle) =>
          sum + (candle.close > 0
            ? ((candle.high - candle.low) / candle.close) * 100
            : 0),
        0,
      ) / recentBars.length
    : null;
  const oneMinuteReturns = recentBars.slice(1).flatMap((candle, index) => {
    const value = percentChange(candle.close, recentBars[index].close);
    return value === null ? [] : [value];
  });
  const realizedVolatility = standardDeviation(oneMinuteReturns);
  const activeBarRatio = recentBars.length > 0
    ? (recentBars.filter((candle) => candle.volume > 0).length /
      recentBars.length) * 100
    : null;
  const spread = quote && quote.bid > 0 && quote.ask >= quote.bid
    ? ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100
    : null;
  const btc15m = changeAtLookback(normalizedBenchmarkCandles, 15);
  const btcRelativeStrength15m = velocity15m !== null && btc15m !== null
    ? velocity15m - btc15m
    : null;
  const peakFailureThreshold = clamp(
    Math.max(5, (averageBarRange ?? 0) * 3),
    5,
    18,
  );
  const peakFailureEvidence = [
    (velocity1m ?? 0) <= -0.75,
    (velocity5m ?? 0) <= -1.5,
    (priceVsVwap ?? 0) <= -0.75,
    (volumeAcceleration ?? 0) >= 1.2 && (velocity1m ?? 0) < 0,
  ].filter(Boolean).length;
  const peakFailureConfirmed = Boolean(
    fresh &&
      (pullbackFromWindowHigh ?? 0) >= peakFailureThreshold &&
      (minutesSinceWindowHigh ?? 0) >= 3 &&
      peakFailureEvidence >= 2,
  );
  const spreadPenalty = spread === null ? 0 : clamp((spread - 0.25) * 8, 0, 24);
  const sparseTradingPenalty = activeBarRatio === null
    ? 0
    : clamp((75 - activeBarRatio) * 0.2, 0, 15);
  const peakFailurePenalty = peakFailureConfirmed
    ? clamp(((pullbackFromWindowHigh ?? 0) - 3) * 4, 12, 35)
    : 0;
  const marketConfirmation = fresh
    ? clamp(
        50 +
          (velocity1m ?? 0) * 7 +
          (velocity5m ?? 0) * 3 +
          (velocity15m ?? 0) * 1.5 +
          ((volumeAcceleration ?? 1) - 1) * 12 +
          (priceVsVwap ?? 0) * 3 +
          (btcRelativeStrength15m ?? 0) * 1.5 -
          spreadPenalty -
          sparseTradingPenalty -
          peakFailurePenalty,
      )
    : 0;

  const supportFlags: string[] = [];
  const riskFlags: string[] = [];
  if ((volumeAcceleration ?? 0) >= 1.5) supportFlags.push("volume_accelerating");
  if ((priceVsVwap ?? 0) > 0) supportFlags.push("price_above_vwap");
  if ((velocity5m ?? 0) >= 1) supportFlags.push("positive_5m_acceleration");
  if ((pullbackFromWindowHigh ?? 100) <= 2) supportFlags.push("holding_near_window_high");
  if ((btcRelativeStrength15m ?? 0) >= 2) supportFlags.push("outperforming_btc");
  if (spread !== null && spread <= 0.5) supportFlags.push("tight_spread");
  if (!fresh) riskFlags.push("market_pulse_stale");
  if (spread !== null && spread > 1.5) riskFlags.push("wide_spread");
  if (peakFailureConfirmed) riskFlags.push("post_peak_breakdown");
  if ((velocity5m ?? 0) <= -2) riskFlags.push("negative_5m_acceleration");
  if ((priceVsVwap ?? 0) <= -1) riskFlags.push("price_below_vwap");
  if ((btcRelativeStrength15m ?? 0) <= -3) riskFlags.push("underperforming_btc");
  if ((activeBarRatio ?? 100) < 60) riskFlags.push("sparse_trading");
  if (orderedCandles.length < 16) riskFlags.push("limited_candle_history");

  const proposedScoreAdjustment = !fresh
    ? 0
    : peakFailureConfirmed
      ? -12
      : spread !== null && spread > 2
        ? -8
        : marketConfirmation >= 80
          ? 8
          : marketConfirmation >= 70
            ? 5
            : marketConfirmation < 30
              ? -10
              : marketConfirmation < 40
                ? -6
                : 0;
  const state = !fresh
    ? "stale"
    : peakFailureConfirmed || marketConfirmation < 40
      ? "weakening"
      : marketConfirmation >= 65
        ? "expanding"
        : "stable";

  return {
    packetVersion: CRYPTO_PROX_VERSION,
    mode: CRYPTO_PROX_MODE,
    productId: opportunity.productId,
    symbol: opportunity.symbol,
    computedAt: now.toISOString(),
    fresh,
    barCount: orderedCandles.length,
    state,
    marketConfirmation: round(marketConfirmation, 1),
    proposedScoreAdjustment,
    shadowOpportunityScore: Math.round(
      clamp(opportunity.opportunityScore + proposedScoreAdjustment),
    ),
    features: {
      velocity1mPercent: finiteOrNull(velocity1m),
      velocity5mPercent: finiteOrNull(velocity5m),
      velocity15mPercent: finiteOrNull(velocity15m),
      volumeAcceleration: finiteOrNull(volumeAcceleration),
      priceVsVwapPercent: finiteOrNull(priceVsVwap),
      spreadPercent: finiteOrNull(spread),
      windowHighPrice: finiteOrNull(windowHighPrice, 10),
      pullbackFromWindowHighPercent: finiteOrNull(pullbackFromWindowHigh),
      minutesSinceWindowHigh: finiteOrNull(minutesSinceWindowHigh),
      averageBarRangePercent: finiteOrNull(averageBarRange),
      realizedVolatilityPercent: finiteOrNull(realizedVolatility),
      activeBarRatioPercent: finiteOrNull(activeBarRatio, 1),
      btcRelativeStrength15mPercent: finiteOrNull(btcRelativeStrength15m),
      peakFailureThresholdPercent: round(peakFailureThreshold),
      peakFailureConfirmed,
    },
    supportFlags,
    riskFlags,
    trace: [
      {
        factor: "market_confirmation",
        value: round(marketConfirmation, 1),
        impact: marketConfirmation >= 65
          ? "supportive"
          : marketConfirmation < 40
            ? "defensive"
            : "neutral",
        reason: "One-, five-, and fifteen-minute movement correlated with volume, VWAP, spread, and BTC-relative strength.",
      },
      {
        factor: "peak_failure",
        value: peakFailureConfirmed,
        impact: peakFailureConfirmed ? "defensive" : "neutral",
        reason: "Requires a volatility-adjusted pullback plus confirming velocity, VWAP, and volume deterioration.",
      },
      {
        factor: "score_authority",
        value: "bounded_authority",
        impact: "neutral",
        reason: "The live-tape adjustment may refine the single HT Crypto score, while deterministic freshness and quality gates control promotion.",
      },
    ],
  };
}
