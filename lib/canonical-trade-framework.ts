// lib/canonical-trade-framework.ts
// One server-side implementation consumed by eligibility, ranking, and display.

import type { SupabaseClient } from "@supabase/supabase-js";

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FRAMEWORK_VERSION = "ctf-v5-stable-history-zones";
const FEATURE_VERSION = 5;
const CACHE_TTL_MINUTES = 45;
// Absolute floor to compute anything at all. Below this there just isn't
// enough price history to derive a true range or a return series.
const MIN_BARS_HARD_FLOOR = 10;
// Bar count considered a fully-seasoned read. Below this the framework still
// computes and passes (assuming it clears the hard floor above), but carries
// a "limited history" warning instead of hard-failing — recent IPOs and
// uplistings are exactly the stocks a momentum/catalyst product should be
// able to surface, not silently exclude for being new.
const SEASONED_BAR_COUNT = 21;

export type MarketSessionState =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "closed"
  | "unknown";

export type TradeFrameworkResult = {
  ticker: string;
  frameworkVersion: string;
  sessionState: MarketSessionState;
  atr14: number | null;
  support: number | null;
  resistance: number | null;
  volatility20d: number | null;
  upsideMin: number | null;
  upsideMax: number | null;
  upsideModel: "resistance_based" | "price_discovery_unmodeled" | "unavailable";
  hasKnownResistance: boolean | null;
  downsideRisk: number | null;
  rrRatio: number | null;
  magnitudeQuality: "meaningful" | "negligible" | null;
  absoluteMagnitudePass: boolean | null;
  relativeMagnitudePass: boolean | null;
  extensionRisk: number | null;
  entryQuality: number | null;
  dataQualityState: "fresh" | "valid_cached" | "stale_but_usable" | "insufficient" | "failed";
  warnings: string[];
  hardFailures: string[];
  passedHardGate: boolean;
  barCount: number | null;
  newestBarAt: string | null;
  calculatedAt: string;
  cacheExpiresAt: string | null;
};

type DailyBar = { o: number; h: number; l: number; c: number; v: number; t: number };
type CachedFeaturePayload = {
  atr14: number;
  volatility20d: number;
  bars: DailyBar[];
  newestBarAt: string | null;
};

const HISTORICAL_RESISTANCE_PRICE_BUFFER_PERCENT = 2;
const HISTORICAL_RESISTANCE_ATR_BUFFER_FRACTION = 0.25;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getMarketSessionState(now = new Date()): MarketSessionState {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "unknown";
    if (weekday === "Sat" || weekday === "Sun") return "closed";
    const minutes = hour * 60 + minute;
    if (minutes >= 240 && minutes < 570) return "pre_market";
    if (minutes >= 570 && minutes < 960) return "regular";
    if (minutes >= 960 && minutes < 1200) return "after_hours";
    return "closed";
  } catch {
    return "unknown";
  }
}

function getDateRange(daysBack: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - Math.max(daysBack * 2, 45));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function computeATR14(bars: DailyBar[]): number {
  // Needs at least a few true-range observations to mean anything; uses
  // whatever window is available up to 14 rather than requiring a full 14.
  if (bars.length < 5) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const current = bars[i];
    const previous = bars[i - 1];
    trueRanges.push(Math.max(current.h - current.l, Math.abs(current.h - previous.c), Math.abs(current.l - previous.c)));
  }
  const window = trueRanges.slice(-14);
  return round(window.reduce((sum, value) => sum + value, 0) / window.length, 4);
}

function computeVolatility20d(bars: DailyBar[]): number {
  // Same relaxation as ATR — a shorter return series from a recent listing
  // is noisier but still a legitimate volatility estimate, not a zero.
  if (bars.length < 6) return 0;
  const window = bars.slice(-21);
  const returns = window.slice(1).map((bar, index) => {
    const previousClose = window[index].c;
    return previousClose > 0 ? (bar.c - previousClose) / previousClose : 0;
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return round(Math.sqrt(variance) * 100, 2);
}

export function excludeIncompleteEasternSessionBar(
  bars: DailyBar[],
  now = new Date(),
) {
  const easternTradingDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return bars.filter((bar) => {
    const barDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(bar.t));
    return barDate < easternTradingDate;
  });
}

export function computeMeaningfulSupportResistance(
  bars: DailyBar[],
  currentPrice: number,
  atr14: number,
) {
  const last20 = bars.slice(-20);
  const supports = last20.flatMap((bar) => [bar.l, bar.c])
    .filter((value) => Number.isFinite(value) && value > 0 && value < currentPrice)
    .sort((a, b) => b - a);
  const resistanceBuffer = Math.max(
    currentPrice * (HISTORICAL_RESISTANCE_PRICE_BUFFER_PERCENT / 100),
    atr14 * HISTORICAL_RESISTANCE_ATR_BUFFER_FRACTION,
  );
  const resistances = last20.flatMap((bar) => [bar.h, bar.c])
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value > currentPrice + resistanceBuffer,
    )
    .sort((a, b) => a - b);
  const supportFallback = Math.max(0.01, currentPrice - Math.max(atr14, currentPrice * 0.05));
  const resistanceFallback = currentPrice + Math.max(atr14, currentPrice * 0.05);
  return {
    support: round(supports[0] ?? supportFallback, 4),
    resistance: round(resistances[0] ?? resistanceFallback, 4),
    hasKnownResistance: resistances.length > 0,
  };
}

async function fetchFreshBars(ticker: string) {
  if (!POLYGON_KEY) throw new Error("Missing POLYGON_API_KEY.");
  const { from, to } = getDateRange(30);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=60&apiKey=${POLYGON_KEY}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  const bars: DailyBar[] = (data?.results ?? []).map((row: Record<string, unknown>) => ({
    o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c), v: Number(row.v), t: Number(row.t),
  })).filter((bar: DailyBar) => [bar.o, bar.h, bar.l, bar.c, bar.t].every(Number.isFinite) && bar.h > 0 && bar.l > 0 && bar.c > 0);
  const newest = bars.at(-1);
  return {
    bars,
    atr14: computeATR14(bars),
    volatility20d: computeVolatility20d(bars),
    barCount: bars.length,
    newestBarAt: newest?.t ? new Date(newest.t).toISOString() : null,
  };
}

function computeFramework(
  ticker: string,
  price: number,
  changePercent: number,
  payload: CachedFeaturePayload,
  dataQualityState: TradeFrameworkResult["dataQualityState"],
  cacheExpiresAt: string | null,
  isConfirmedContinuationRunner: boolean = false,
): TradeFrameworkResult {
  const calculatedAt = new Date().toISOString();
  const sessionState = getMarketSessionState();
  const warnings: string[] = [];
  const hardFailures: string[] = [];

  if (!Number.isFinite(price) || price <= 0 || payload.bars.length < MIN_BARS_HARD_FLOOR || payload.atr14 <= 0 || payload.volatility20d <= 0) {
    hardFailures.push("Insufficient historical data for canonical evaluation.");
    return {
      ticker, frameworkVersion: FRAMEWORK_VERSION, sessionState,
      atr14: payload.atr14 || null, support: null, resistance: null,
      volatility20d: payload.volatility20d || null,
      upsideMin: null, upsideMax: null, upsideModel: "unavailable", hasKnownResistance: null,
      downsideRisk: null, rrRatio: null,
      magnitudeQuality: null, absoluteMagnitudePass: null, relativeMagnitudePass: null,
      extensionRisk: null, entryQuality: null, dataQualityState: "insufficient",
      warnings: [`At least ${MIN_BARS_HARD_FLOOR} valid daily bars are required.`], hardFailures,
      passedHardGate: false, barCount: payload.bars.length, newestBarAt: payload.newestBarAt,
      calculatedAt, cacheExpiresAt,
    };
  }
  if (payload.bars.length < SEASONED_BAR_COUNT) {
    warnings.push(`Limited trading history (${payload.bars.length} sessions) — recent listing or uplisting; treat ATR/volatility as provisional.`);
  }

  const newestClose = payload.bars.at(-1)?.c ?? 0;
  const priceDeviationPct =
    newestClose > 0 ? (Math.abs(price - newestClose) / newestClose) * 100 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(priceDeviationPct) || priceDeviationPct > 35) {
    const reason = `Live price is inconsistent with recent adjusted history (${round(priceDeviationPct, 1)}% deviation).`;
    hardFailures.push(reason);
    return {
      ticker, frameworkVersion: FRAMEWORK_VERSION, sessionState,
      atr14: payload.atr14, support: null, resistance: null,
      volatility20d: payload.volatility20d,
      upsideMin: null, upsideMax: null, upsideModel: "unavailable", hasKnownResistance: null,
      downsideRisk: null, rrRatio: null,
      magnitudeQuality: null, absoluteMagnitudePass: null, relativeMagnitudePass: null,
      extensionRisk: null, entryQuality: null, dataQualityState: "failed",
      warnings: [reason], hardFailures, passedHardGate: false,
      barCount: payload.bars.length, newestBarAt: payload.newestBarAt,
      calculatedAt, cacheExpiresAt,
    };
  }

  const { support, resistance, hasKnownResistance } = computeMeaningfulSupportResistance(
    payload.bars,
    price,
    payload.atr14,
  );
  const atrPct = (payload.atr14 / price) * 100;
  const extensionRisk = round(Math.min(100, Math.max(0, (Math.abs(changePercent) / atrPct) * 25)), 1);
  const compression = isConfirmedContinuationRunner
    ? 1
    : extensionRisk >= 75 ? 0.5 : extensionRisk >= 50 ? 0.75 : 1;
  const rawUpsidePct = Math.max(0, ((resistance - price) / price) * 100);
  const rawDownsidePct = Math.max(0, ((price - support) / price) * 100);
  const downsideRisk = round(Math.max(rawDownsidePct, atrPct * 0.3), 2);
  if (downsideRisk >= 100) {
    const reason =
      "Volatility model implies downside at or beyond the full share price; the trade framework is invalid.";
    warnings.push(reason);
    hardFailures.push(reason);
    return {
      ticker,
      frameworkVersion: FRAMEWORK_VERSION,
      sessionState,
      atr14: payload.atr14,
      support,
      resistance,
      volatility20d: payload.volatility20d,
      upsideMin: null,
      upsideMax: null,
      upsideModel: "unavailable",
      hasKnownResistance,
      downsideRisk: null,
      rrRatio: null,
      magnitudeQuality: null,
      absoluteMagnitudePass: null,
      relativeMagnitudePass: null,
      extensionRisk,
      entryQuality: 0,
      dataQualityState: "failed",
      warnings,
      hardFailures,
      passedHardGate: false,
      barCount: payload.bars.length,
      newestBarAt: payload.newestBarAt,
      calculatedAt,
      cacheExpiresAt,
    };
  }
  // A runner above every observed resistance level is in price discovery.
  // The ATR fallback is useful for locating a chart reference, but it is not
  // an independently observed upside ceiling. In that state we deliberately
  // publish no upside percentage and no R:R. In particular, upside is never
  // floored by downside: unknown remains unknown.
  const isUnmodeledPriceDiscovery =
    isConfirmedContinuationRunner && !hasKnownResistance;
  const upsideReference = isUnmodeledPriceDiscovery
    ? null
    : isConfirmedContinuationRunner
      ? rawUpsidePct
      : Math.max(rawUpsidePct, atrPct * 0.5) * compression;
  const upsideMin = upsideReference === null ? null : round(upsideReference * 0.7, 2);
  const upsideMax = upsideReference === null ? null : round(upsideReference * 1.3, 2);
  let rrRatio = upsideReference !== null && downsideRisk > 0
    ? round(upsideReference / downsideRisk, 2)
    : null;
  if (rrRatio !== null) rrRatio = Math.min(12, rrRatio);

  const absoluteMagnitudePass = upsideMax === null ? null : upsideMax >= 5;
  // FIXED: was `upsideMax >= atrPct` — requiring projected upside to
  // exceed the stock's ENTIRE normal daily range, not a meaningful
  // fraction of it. That rejected real opportunities like RUBI (up 32%,
  // 6.9x real volume, upsideMax 16.77% — already 3x over the absolute
  // 5% floor) purely because 16.77% didn't clear its full 19.86% ATR.
  // Real, tradeable room doesn't require space for an entire additional
  // average day's move stacked on top. Half the normal range is still a
  // real, defensible bar meaningfully above the flat 5% floor.
  const relativeMagnitudePass = upsideMax === null ? null : upsideMax >= atrPct * 0.5;
  const magnitudeQuality = absoluteMagnitudePass === null || relativeMagnitudePass === null
    ? null
    : absoluteMagnitudePass && relativeMagnitudePass ? "meaningful" : "negligible";

  let entryQuality = 100;
  if (extensionRisk >= 75) entryQuality -= 50;
  else if (extensionRisk >= 50) entryQuality -= 25;
  else if (extensionRisk >= 35) entryQuality -= 10;
  if (!isUnmodeledPriceDiscovery && (rrRatio === null || rrRatio < 1)) entryQuality -= 35;
  else if (rrRatio !== null && rrRatio < 1.5) entryQuality -= 15;
  if (downsideRisk >= Math.max(15, atrPct * 3)) entryQuality -= 20;
  if (absoluteMagnitudePass === false) entryQuality -= 15;
  if (relativeMagnitudePass === false) entryQuality -= 10;
  entryQuality = Math.max(0, Math.min(100, Math.round(entryQuality)));

  if (isUnmodeledPriceDiscovery) {
    warnings.push("Price discovery: upside and R:R are not reliably modeled after the breakout.");
  } else if (rrRatio === null || rrRatio < 1) {
    const reason = `R:R ${rrRatio ?? "unavailable"} is below the 1.0 hard floor.`;
    warnings.push(reason); hardFailures.push(reason);
  } else if (rrRatio < 1.5) warnings.push(`R:R ${rrRatio}:1 is inside the caution band.`);
  if (absoluteMagnitudePass === false) warnings.push("Projected maximum upside is below the provisional 5% absolute floor.");
  if (relativeMagnitudePass === false) warnings.push("Projected maximum upside is below half of one normal ATR range.");
  // Deliberately NOT pushed to hardFailures here. Upside is measured as
  // distance to the next resistance level, which is small by definition for
  // a stock that hasn't broken out yet — exactly the profile Before The
  // Crowd exists to catch. Spot Momentum (where "is there room left to run"
  // is the right question) applies this as a hard gate itself, strategy-
  // side, using magnitudeQuality below. Before The Crowd relies on its own
  // crowd/trap ceilings instead. Framework stays strategy-agnostic; the
  // caller decides what's blocking.
  if (extensionRisk >= 75) warnings.push("The setup is extremely extended relative to ATR.");
  if (downsideRisk >= Math.max(20, atrPct * 4)) {
    const reason = "Modeled downside is excessive in absolute and volatility-relative terms.";
    warnings.push(reason); hardFailures.push(reason);
  }
  if (sessionState === "pre_market" || sessionState === "after_hours") warnings.push(`Evaluation uses ${sessionState.replace("_", " ")} price action.`);
  else if (sessionState === "closed") warnings.push("Market is closed; this is not a live-entry evaluation.");

  return {
    ticker, frameworkVersion: FRAMEWORK_VERSION, sessionState,
    atr14: payload.atr14, support, resistance, volatility20d: payload.volatility20d,
    upsideMin, upsideMax,
    upsideModel: isUnmodeledPriceDiscovery ? "price_discovery_unmodeled" : "resistance_based",
    hasKnownResistance,
    downsideRisk, rrRatio, magnitudeQuality,
    absoluteMagnitudePass, relativeMagnitudePass, extensionRisk, entryQuality,
    dataQualityState, warnings, hardFailures, passedHardGate: hardFailures.length === 0,
    barCount: payload.bars.length, newestBarAt: payload.newestBarAt,
    calculatedAt, cacheExpiresAt,
  };
}

export async function getTradeFramework(
  supabase: SupabaseClient,
  ticker: string,
  price: number,
  changePercent: number,
  isConfirmedContinuationRunner: boolean = false,
): Promise<TradeFrameworkResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const now = new Date();
  const { data: cached, error: cacheReadError } = await supabase
    .from("ht_feature_cache")
    .select("*")
    .eq("ticker", normalizedTicker)
    .eq("feature_name", "trade_framework")
    .eq("feature_version", FEATURE_VERSION)
    .maybeSingle();
  if (cacheReadError) console.error("[trade-framework] cache read failed:", cacheReadError.message);
  if (cached?.calculated_value && new Date(cached.expires_at) > now) {
    return computeFramework(normalizedTicker, price, changePercent, cached.calculated_value as CachedFeaturePayload, "valid_cached", cached.expires_at, isConfirmedContinuationRunner);
  }

  const fresh = await fetchFreshBars(normalizedTicker);
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MINUTES * 60 * 1000).toISOString();
  if (!fresh) {
    await supabase.from("ht_feature_cache").upsert({
      ticker: normalizedTicker, feature_name: "trade_framework", feature_version: FEATURE_VERSION,
      calculated_value: null, bar_count: 0, data_quality_state: "failed",
      calculated_at: now.toISOString(), expires_at: expiresAt, error_state: "Polygon bars fetch failed",
    }, { onConflict: "ticker,feature_name,feature_version" });
    return {
      ticker: normalizedTicker, frameworkVersion: FRAMEWORK_VERSION, sessionState: getMarketSessionState(),
      atr14: null, support: null, resistance: null, volatility20d: null,
      upsideMin: null, upsideMax: null, upsideModel: "unavailable", hasKnownResistance: null,
      downsideRisk: null, rrRatio: null,
      magnitudeQuality: null, absoluteMagnitudePass: null, relativeMagnitudePass: null,
      extensionRisk: null, entryQuality: null, dataQualityState: "failed",
      warnings: ["Polygon bars fetch failed."], hardFailures: ["Canonical trade-framework data is unavailable."],
      passedHardGate: false, barCount: null, newestBarAt: null,
      calculatedAt: now.toISOString(), cacheExpiresAt: expiresAt,
    };
  }

  const completedBars = excludeIncompleteEasternSessionBar(fresh.bars, now);
  const payload: CachedFeaturePayload = {
    atr14: computeATR14(completedBars),
    volatility20d: computeVolatility20d(completedBars),
    bars: completedBars,
    newestBarAt: completedBars.at(-1)?.t
      ? new Date(completedBars.at(-1)!.t).toISOString()
      : null,
  };
  const completedBarCount = completedBars.length;
  const quality = completedBarCount >= SEASONED_BAR_COUNT
    ? "fresh"
    : completedBarCount >= MIN_BARS_HARD_FLOOR ? "stale_but_usable" : "insufficient";
  const { error: cacheWriteError } = await supabase.from("ht_feature_cache").upsert({
    ticker: normalizedTicker, feature_name: "trade_framework", feature_version: FEATURE_VERSION,
    calculated_value: payload, bar_count: completedBarCount, data_quality_state: quality,
    calculated_at: now.toISOString(), source_last_updated_at: payload.newestBarAt,
    expires_at: expiresAt, error_state: null,
  }, { onConflict: "ticker,feature_name,feature_version" });
  if (cacheWriteError) console.error("[trade-framework] cache write failed:", cacheWriteError.message);
  return computeFramework(normalizedTicker, price, changePercent, payload, quality, expiresAt, isConfirmedContinuationRunner);
}
