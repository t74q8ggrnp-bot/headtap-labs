/** Crypto-only research. No public rank, probability, order or position authority. */
// @ts-expect-error Node's built-in research/test runner requires source extensions.
import { evaluateCryptoAssetPolicy } from "./asset-policy.ts";

export const CRYPTO_LIVE_RESEARCH_POLICY = Object.freeze({
  version: "crypto-live-research-v1" as const,
  // Owner-selected target; this module does not install or change a scheduler.
  scanIntervalMs: 60_000,
  tradeMaxAgeMs: 30_000,
  bookMaxAgeMs: 15_000,
  tradeBookAlignmentMs: 15_000,
  candleMaxAgeMs: 90_000,
  futureToleranceMs: 2_000,
  requiredClosedMinutes: 61,
  // Initial hypotheses, not fitted parameters or a calibrated win probability.
  weights: Object.freeze({ momentum: 30, participation: 25, structure: 25, tradability: 20 }),
});

export type CryptoResearchIdentity = {
  provider: string;
  marketId: string;
  base: string;
  quote: "USD";
};
export type CryptoResearchTrade = { price: number; asOf: string };
export type CryptoResearchBook = { bid: number; ask: number; asOf: string };
export type CryptoResearchCandle = {
  time: number; // UTC bucket start, epoch seconds; exactly one minute.
  asOf: string; // Provider's actual last event in this bucket, NOT its nominal end.
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type CryptoLiveResearchInput = {
  identity: CryptoResearchIdentity;
  decisionAt: string;
  trade: CryptoResearchTrade;
  book: CryptoResearchBook | null;
  candles: CryptoResearchCandle[];
  marketState: "normal" | "halted" | "unavailable" | "suspect";
  // Optional raw trades; never synthesize 10s/30s evidence from minute bars.
  recentTrades?: CryptoResearchTrade[];
};
export type CryptoResearchCosts = {
  version: string;
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
};
export type CryptoLiveResearchResult = {
  policyVersion: typeof CRYPTO_LIVE_RESEARCH_POLICY.version;
  authority: "research_only";
  identity: CryptoResearchIdentity;
  decisionAt: string;
  marketAsOf: string | null;
  bookAsOf: string | null;
  candleAsOf: string | null;
  score: number | null;
  state: "unavailable" | "strengthening" | "developing" | "cooling" | "mixed";
  probabilityOfProfit: null;
  expectedNetReturnPercent: null;
  executionAuthorized: false;
  failures: string[];
  observations: string[];
  components: Record<keyof typeof CRYPTO_LIVE_RESEARCH_POLICY.weights, number> | null;
  features: {
    return1m: number;
    return3m: number;
    return5m: number;
    return15m: number;
    return30m: number;
    return10s: number | null;
    return30s: number | null;
    acceleration5m: number;
    baselineMinuteRangePercent: number;
    volumeAcceleration5m: number;
    activeMinutesPercent: number;
    estimatedDollarVolume5m: number;
    priceVsVwap15mPercent: number;
    directionalEfficiency15m: number;
    higherLow: boolean;
    pullback15mPercent: number;
    spreadPercent: number;
    roundTripCostPercent: number | null;
    breakEvenExitBid: number | null;
    observedRange15mPercent: number;
    movePerMinuteOfRisk: number;
  } | null;
  costs: CryptoResearchCosts | null;
};

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const round = (n: number) => Number(n.toFixed(6));
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const average = (ns: number[]) => ns.reduce((total, n) => total + n, 0) / ns.length;
const change = (current: number, prior: number) => (current / prior - 1) * 100;

export function cryptoResearchTimestamp(value: unknown): number {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : NaN;
}

export function validCryptoResearchCosts(costs: CryptoResearchCosts): boolean {
  return typeof costs.version === "string" && costs.version.trim().length > 0 &&
    nonnegative(costs.feeBpsPerSide) && costs.feeBpsPerSide < 10_000 &&
    nonnegative(costs.slippageBpsPerSide) && costs.slippageBpsPerSide < 10_000;
}

function tradeLookback(trades: CryptoResearchTrade[], last: CryptoResearchTrade, seconds: number) {
  const end = cryptoResearchTimestamp(last.asOf);
  const target = end - seconds * 1_000;
  const preceding = trades.filter(trade => positive(trade.price) &&
    cryptoResearchTimestamp(trade.asOf) <= target &&
    target - cryptoResearchTimestamp(trade.asOf) <= 2_000)
    .sort((a, b) => cryptoResearchTimestamp(b.asOf) - cryptoResearchTimestamp(a.asOf))[0];
  return preceding ? round(change(last.price, preceding.price)) : null;
}

/** Raw market facts only. The 24h move and existing scores/ranks are not inputs. */
export function evaluateCryptoLiveResearch(
  input: CryptoLiveResearchInput,
  costs: CryptoResearchCosts | null = null,
): CryptoLiveResearchResult {
  const policy = CRYPTO_LIVE_RESEARCH_POLICY;
  const now = cryptoResearchTimestamp(input.decisionAt);
  const tradeTime = cryptoResearchTimestamp(input.trade?.asOf);
  const bookTime = cryptoResearchTimestamp(input.book?.asOf);
  const failures: string[] = [];
  const result: CryptoLiveResearchResult = {
    policyVersion: policy.version, authority: "research_only",
    identity: { provider: input.identity.provider, marketId: input.identity.marketId, base: input.identity.base, quote: input.identity.quote },
    decisionAt: input.decisionAt, marketAsOf: Number.isFinite(tradeTime) ? input.trade.asOf : null,
    bookAsOf: Number.isFinite(bookTime) ? input.book!.asOf : null, candleAsOf: null,
    score: null, state: "unavailable", probabilityOfProfit: null, expectedNetReturnPercent: null,
    executionAuthorized: false, failures, observations: [], components: null, features: null,
    costs: costs ? { ...costs } : null,
  };
  if (!Number.isFinite(now) || now <= 0) failures.push("invalid_decision_time");
  if (!input.identity?.provider || !input.identity.marketId || !input.identity.base || input.identity.quote !== "USD") {
    failures.push("unverified_native_usd_market");
  }
  const assetPolicy = evaluateCryptoAssetPolicy(input.identity.base);
  if (!assetPolicy.allowed) failures.push(`asset_policy_${assetPolicy.reason}`);
  if (input.marketState === "halted" || input.marketState === "suspect") failures.push("market_integrity_failure");
  if (input.marketState === "unavailable") result.observations.push("Market halt/status evidence is unavailable; execution remains disabled.");
  if (!["normal", "halted", "suspect", "unavailable"].includes(input.marketState)) failures.push("invalid_market_state");
  if (!positive(input.trade?.price) || !Number.isFinite(tradeTime) || tradeTime <= 0 ||
      tradeTime > now + policy.futureToleranceMs || now - tradeTime > policy.tradeMaxAgeMs) {
    failures.push("invalid_or_stale_trade");
  }
  if (!input.book || !positive(input.book.bid) || !positive(input.book.ask) || input.book.ask < input.book.bid ||
      !Number.isFinite(bookTime) || bookTime <= 0 || bookTime > now + policy.futureToleranceMs ||
      now - bookTime > policy.bookMaxAgeMs) failures.push("invalid_or_stale_book");
  if (Number.isFinite(tradeTime) && Number.isFinite(bookTime) &&
      Math.abs(tradeTime - bookTime) > policy.tradeBookAlignmentMs) failures.push("trade_book_misaligned");
  if (costs && !validCryptoResearchCosts(costs)) failures.push("invalid_cost_assumptions");

  const source = new Map<number, CryptoResearchCandle>();
  for (const bar of input.candles) {
    const eventTime = cryptoResearchTimestamp(bar.asOf);
    if (!Number.isSafeInteger(bar.time) || bar.time <= 0 || bar.time % 60 !== 0 ||
        ![bar.open, bar.high, bar.low, bar.close].every(positive) || !nonnegative(bar.volume) ||
        bar.high < Math.max(bar.open, bar.low, bar.close) || bar.low > Math.min(bar.open, bar.high, bar.close) ||
        !Number.isFinite(eventTime) || eventTime < bar.time * 1_000 || eventTime >= (bar.time + 60) * 1_000 ||
        eventTime > now + policy.futureToleranceMs) {
      failures.push("invalid_or_future_candle");
      continue;
    }
    // In-progress OHLC is legitimate context, but cannot leak into closed-minute features.
    if ((bar.time + 60) * 1_000 > now) continue;
    const prior = source.get(bar.time);
    if (prior && JSON.stringify(prior) !== JSON.stringify(bar)) failures.push("conflicting_candle_versions");
    source.set(bar.time, bar);
  }
  const ordered = [...source.values()].sort((a, b) => a.time - b.time);
  const bars = ordered.slice(-policy.requiredClosedMinutes);
  const last = bars.at(-1);
  result.candleAsOf = last?.asOf ?? null;
  if (!last || now - cryptoResearchTimestamp(last.asOf) > policy.candleMaxAgeMs ||
      Math.abs(tradeTime - cryptoResearchTimestamp(last.asOf)) > policy.candleMaxAgeMs) {
    failures.push("stale_or_misaligned_candles");
  }
  if (bars.length !== policy.requiredClosedMinutes || bars.some((bar, i) => i > 0 && bar.time - bars[i - 1].time !== 60)) {
    failures.push("incomplete_minute_history");
  }
  if (failures.length || !last || !input.book) {
    result.failures = [...new Set(failures)];
    return result;
  }

  // Every momentum window is anchored to the SAME latest completed provider candle.
  const returns = [1, 3, 5, 15, 30].map(n => change(last.close, bars[bars.length - 1 - n].close));
  const [r1, r3, r5, r15, r30] = returns;
  const prior5 = change(bars[bars.length - 6].close, bars[bars.length - 11].close);
  const recent = bars.slice(-5);
  const baseline = bars.slice(-60, -5);
  const baselineVolume = average(baseline.map(bar => bar.volume));
  const baselineRange = average(baseline.map(bar => (bar.high - bar.low) / bar.close * 100));
  if (!positive(baselineVolume) || !positive(baselineRange)) {
    result.failures = ["insufficient_activity_baseline"];
    return result;
  }
  const volAcceleration = average(recent.map(bar => bar.volume)) / baselineVolume;
  const activeRatio = bars.slice(-60).filter(bar => bar.volume > 0).length / 60 * 100;
  const short = bars.slice(-15);
  const shortVolume = short.reduce((sum, bar) => sum + bar.volume, 0);
  if (!positive(shortVolume)) { result.failures = ["no_recent_trading"]; return result; }
  const vwap = short.reduce((sum, bar) => sum + (bar.high + bar.low + bar.close) / 3 * bar.volume, 0) / shortVolume;
  const recentHigh = Math.max(...short.map(bar => bar.high));
  const recentLow = Math.min(...short.map(bar => bar.low));
  const pullback = Math.max(0, (recentHigh - input.trade.price) / recentHigh * 100);
  const path = short.slice(1).reduce((sum, bar, i) => sum + Math.abs(bar.close - short[i].close), 0);
  const efficiency = path > 0 ? (last.close - short[0].close) / path : 0;
  const higherLow = Math.min(...recent.map(bar => bar.low)) > Math.min(...bars.slice(-10, -5).map(bar => bar.low));
  const spread = (input.book.ask - input.book.bid) / ((input.book.ask + input.book.bid) / 2) * 100;
  const range15 = (recentHigh - recentLow) / recentLow * 100;
  const divergence = Math.abs(change(input.trade.price, last.close));
  // Volatility-scaled coherence check. A new unconfirmed jump needs another provider observation.
  if (divergence > Math.max(baselineRange * 6, spread * 3, 0.25)) {
    result.failures = ["trade_candle_divergence"];
    return result;
  }
  const fee = costs ? costs.feeBpsPerSide / 10_000 : null;
  const slip = costs ? costs.slippageBpsPerSide / 10_000 : null;
  const breakEven = fee !== null && slip !== null
    ? input.book.ask * (1 + slip) * (1 + fee) / ((1 - slip) * (1 - fee)) : null;
  const roundTrip = breakEven === null ? null : change(breakEven, input.book.bid);
  const momentum = clamp(50 + 12 * (
    0.15 * r1 / baselineRange + 0.2 * r3 / (baselineRange * Math.sqrt(3)) +
    0.4 * r5 / (baselineRange * Math.sqrt(5)) + 0.25 * r15 / (baselineRange * Math.sqrt(15))) +
    4 * clamp((r5 - prior5) / (baselineRange * Math.sqrt(5)), -3, 3));
  // Accelerating sell volume must not be mistaken for accumulation.
  const volumeSupport = clamp(50 + 25 * Math.log2(Math.max(0.125, volAcceleration)));
  const participation = (r5 <= 0 ? Math.min(40, volumeSupport) : volumeSupport) * (activeRatio / 100);
  const structure = clamp(50 + efficiency * 25 + (higherLow ? 10 : -5) +
    clamp(change(input.trade.price, vwap) / baselineRange, -4, 4) * 4 -
    clamp(pullback / baselineRange - 3, 0, 5) * 4);
  const dollarVolume = recent.reduce((sum, bar) => sum + (bar.open + bar.high + bar.low + bar.close) / 4 * bar.volume, 0);
  const liquidity = clamp((Math.log10(Math.max(1, dollarVolume)) - 3) * 25);
  // Realized range is a cost comparison, NOT forecast upside or a price target.
  const friction = roundTrip ?? spread;
  const tradability = clamp(liquidity * 0.5 + 50 * (1 - clamp(friction / Math.max(range15, 1e-12), 0, 1)));
  const components = { momentum, participation, structure, tradability };
  const score = Object.entries(policy.weights).reduce((sum, [key, weight]) =>
    sum + components[key as keyof typeof components] * weight / 100, 0);
  if (![...returns, prior5, volAcceleration, vwap, pullback, efficiency, spread, range15, divergence,
    dollarVolume, score, ...Object.values(components)].every(Number.isFinite) ||
    (breakEven !== null && !positive(breakEven)) || (roundTrip !== null && !Number.isFinite(roundTrip))) {
    result.failures = ["non_finite_derived_evidence"];
    return result;
  }
  result.components = Object.fromEntries(Object.entries(components).map(([key, n]) => [key, round(n)])) as typeof components;
  result.score = Math.round(score);
  result.state = r5 < 0 && (efficiency < 0 || input.trade.price < vwap) ? "cooling"
    : result.score >= 65 && r5 > 0 && r15 > 0 && volAcceleration >= 1 ? "strengthening"
    : r3 > 0 && r5 > prior5 && volAcceleration > 1 ? "developing" : "mixed";
  result.features = {
    return1m: round(r1), return3m: round(r3), return5m: round(r5), return15m: round(r15), return30m: round(r30),
    return10s: tradeLookback(input.recentTrades ?? [], input.trade, 10),
    return30s: tradeLookback(input.recentTrades ?? [], input.trade, 30),
    acceleration5m: round(r5 - prior5), baselineMinuteRangePercent: round(baselineRange),
    volumeAcceleration5m: round(volAcceleration), activeMinutesPercent: round(activeRatio),
    estimatedDollarVolume5m: round(dollarVolume), priceVsVwap15mPercent: round(change(input.trade.price, vwap)),
    directionalEfficiency15m: round(efficiency), higherLow, pullback15mPercent: round(pullback),
    spreadPercent: round(spread), roundTripCostPercent: roundTrip === null ? null : round(roundTrip),
    breakEvenExitBid: breakEven, observedRange15mPercent: round(range15),
    movePerMinuteOfRisk: round(r5 / (baselineRange * Math.sqrt(5))),
  };
  result.observations.push(
    `${result.state}: 5-minute movement ${round(r5)}%; recent volume ${round(volAcceleration)}x its preceding baseline.`,
    "24-hour gain contributes no score points. This score is not a profit probability or trade authorization.",
  );
  if (!costs) result.observations.push("Exchange fees and slippage are unspecified; net-cost readiness is not established.");
  if (roundTrip !== null && roundTrip >= range15) result.observations.push("Estimated round-trip friction exceeds the observed 15-minute range; this is not a return forecast.");
  if (result.features.return10s === null || result.features.return30s === null) result.observations.push("Sub-minute trade history is incomplete; 10s/30s momentum is not inferred from candles.");
  return result;
}

/** Complete denominator: every supplied market receives a result, including abstentions. */
export function rankCryptoLiveResearch(inputs: CryptoLiveResearchInput[], costs: CryptoResearchCosts | null = null) {
  const decisions = inputs.map(input => evaluateCryptoLiveResearch(input, costs));
  const keys = new Set<string>();
  for (const decision of decisions) {
    const key = `${decision.identity.provider}:${decision.identity.marketId}`;
    if (keys.has(key)) throw new Error("Duplicate research market in one frame.");
    keys.add(key);
  }
  if (new Set(decisions.map(item => cryptoResearchTimestamp(item.decisionAt))).size > 1) {
    throw new Error("Research candidates must share one decision timestamp.");
  }
  const ranked = decisions.filter(item => item.score !== null)
    .sort((a, b) => b.score! - a.score! || a.identity.marketId.localeCompare(b.identity.marketId));
  return {
    policyVersion: CRYPTO_LIVE_RESEARCH_POLICY.version, authority: "research_only" as const,
    evaluated: decisions.length, scored: ranked.length, unavailable: decisions.length - ranked.length,
    decisions, rankedMarkets: ranked.map(item => item.identity.marketId),
    publicRankingChanged: false, executionAuthorized: false,
  };
}
