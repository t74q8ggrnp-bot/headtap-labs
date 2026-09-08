import type { CoinApiBar } from "./coinapi-normalize";

export type CoinApiHistoryCache = {
  marketId: string; fetchedAt: string; bars: CoinApiBar[];
  retryAfter?: string; failure?: "incomplete_candle_history" | "conflicting_or_invalid_candle_history";
};
export const COINAPI_HISTORY_POLICY = Object.freeze({
  version: "coinapi-history-v2", maxMarkets: 128, maxBars: 65, incompleteRetryMs: 300_000,
});

export function hasCompleteCoinApiHistory(bars: CoinApiBar[], now: number) {
  const requiredLast = Math.floor(now / 60_000) * 60 - 60;
  const closed = bars.filter(bar => bar.time <= requiredLast).slice(-61);
  return closed.length === 61 && closed.every((bar, index) => bar.time === requiredLast - (60 - index) * 60);
}

/** A shared, bounded cache. Provider clocks, never cache age, determine bar coverage. */
export function planCoinApiHistory(marketId: string, cache: CoinApiHistoryCache | undefined, now: number) {
  const usable = cache?.marketId === marketId && Date.parse(cache.fetchedAt) <= now &&
    now - Date.parse(cache.fetchedAt) < 3_600_000;
  const bars = usable ? cache.bars.filter(bar => bar.time * 1_000 <= now) : [];
  const complete = hasCompleteCoinApiHistory(bars, now);
  // Repeated selections within the same minute reuse complete closed evidence.
  if (complete && !cache?.failure) return { path: null, cached: bars, reason: "complete_cache" };
  // Persist negative results too: otherwise empty/conflicting/sparse providers
  // are billed again on every selection. This is a fetch cooldown, NOT fresh data.
  const retryAt = Date.parse(cache?.retryAfter ?? "");
  if (usable && cache?.failure && retryAt > now &&
      retryAt <= Date.parse(cache.fetchedAt) + COINAPI_HISTORY_POLICY.incompleteRetryMs) {
    return { path: null, cached: cache.failure === "conflicting_or_invalid_candle_history" ? [] : bars,
      reason: "retry_deferred" };
  }
  const latest = bars.at(-1);
  // An internal hole cannot be repaired by repeatedly fetching the latest three
  // bars. Re-read the bounded window; never pad the hole with an invented bar.
  const internalGap = bars.some((bar, index) => index > 0 && bar.time - bars[index - 1].time !== 60);
  const limit = latest && bars.length >= 61 && !internalGap
    ? Math.min(65, Math.max(3, Math.ceil((now / 1_000 - latest.time) / 60) + 2)) : 65;
  return { path: `/v1/ohlcv/${marketId}/latest?period_id=1MIN&limit=${limit}`, cached: bars,
    reason: !latest ? "initial_history" : internalGap || bars.length < 61 ? "gap_recheck" : "incremental_update" };
}

export function mergeCoinApiHistory(cached: CoinApiBar[], incoming: CoinApiBar[]): CoinApiBar[] {
  const byTime = new Map<number, CoinApiBar>();
  for (const bar of [...cached, ...incoming]) {
    const prior = byTime.get(bar.time);
    if (prior && prior.closeAsOf === bar.closeAsOf &&
        ["open", "high", "low", "close", "volume"].some(key =>
          prior[key as keyof CoinApiBar] !== bar[key as keyof CoinApiBar])) {
      throw new Error("CoinAPI conflicting cached candle version.");
    }
    if (!prior || Date.parse(prior.closeAsOf) < Date.parse(bar.closeAsOf)) byTime.set(bar.time, { ...bar });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-COINAPI_HISTORY_POLICY.maxBars);
}

export function boundCoinApiHistory(cache: Record<string, CoinApiHistoryCache>, validMarkets: Set<string>) {
  return Object.fromEntries(Object.entries(cache).filter(([id]) => validMarkets.has(id))
    .sort((a, b) => Date.parse(b[1].fetchedAt) - Date.parse(a[1].fetchedAt) || a[0].localeCompare(b[0]))
    .slice(0, COINAPI_HISTORY_POLICY.maxMarkets));
}
