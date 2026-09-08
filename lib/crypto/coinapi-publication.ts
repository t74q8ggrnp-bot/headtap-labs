import type { PilotFrame } from "./coinapi-pilot";
import type { CoinApiMarket } from "./coinapi-normalize";
// @ts-expect-error Node source imports.
import { buildCoinApiChart } from "./coinapi-normalize.ts";

/** JSONB reorders object keys; evidence hashes must survive a database round trip. */
export function canonicalCryptoJson(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-finite crypto evidence.");
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
      .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, ordered(v)]));
    return item;
  }
  return JSON.stringify(ordered(value));
}

function ageSeconds(asOf: string | null | undefined, now: number) {
  const time = asOf ? Date.parse(asOf) : NaN;
  return Number.isFinite(time) && time <= now ? (now - time) / 1_000 : null;
}

/** Pure backend presenter. Every desktop/native/Agent reader gets the SAME
 * publication and price/candle close. No fetch, ranking, or execution fallback. */
export function presentCoinApiPublication(frame: PilotFrame, now: number, onlyMarket?: string) {
  const evidence = new Map(frame.evidence.map(row => [row.identity.marketId, row]));
  const decisions = new Map(frame.research.decisions.map(row => [row.identity.marketId, row]));
  const coverage = new Map(frame.coverage.map(row => [row.marketId, row]));
  const markets = frame.quotes.filter(q => !onlyMarket || q.marketId === onlyMarket).map(q => {
    const identity = /^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_([A-Z0-9.-]+)_USD$/.exec(q.marketId);
    if (!identity) throw new Error("Unverified publication market identity.");
    const input = evidence.get(q.marketId);
    const market: CoinApiMarket = { symbolId: q.marketId, venue: identity[1] as CoinApiMarket["venue"],
      base: identity[2], quote: "USD", catalogAsOf: null, volume30d: null };
    let chart: ReturnType<typeof buildCoinApiChart> | null = null;
    if (input && q.trade && !coverage.get(q.marketId)?.failures.includes("conflicting_or_invalid_candle_history")) {
      try {
        chart = buildCoinApiChart(market, input.candles.map(bar => ({ ...bar, closeAsOf: bar.asOf })), q.trade, now);
      } catch { /* Absent/invalid history remains absent; no provider fallback. */ }
    }
    const price = chart?.displayQuote.price ?? q.trade?.price ?? null;
    const priceAsOf = chart?.displayQuote.asOf ?? q.trade?.asOf ?? null;
    const priceAge = ageSeconds(priceAsOf, now);
    const bookAge = ageSeconds(q.book?.asOf, now);
    const quoteAligned = q.trade && q.book &&
      Math.abs(Date.parse(q.trade.asOf) - Date.parse(q.book.asOf)) <= 15_000;
    const failures = new Set(coverage.get(q.marketId)?.failures ?? q.failures);
    if (priceAge === null || priceAge > 30) failures.add("price_not_current");
    if (bookAge === null || bookAge > 15) failures.add("book_not_current");
    if (!quoteAligned) failures.add("trade_book_misaligned_or_missing");
    return {
      marketId: q.marketId, provider: "coinapi", exchange: market.venue, base: market.base, quoteCurrency: "USD",
      price, priceAsOf, priceAgeSeconds: priceAge,
      priceStatus: price === null ? "unavailable" : priceAge !== null && priceAge <= 30 ? "current" : "stale",
      source: chart?.displayQuote.source ?? (q.trade ? "coinapi_crypto_trade" : null),
      chart, book: q.book, bookAgeSeconds: bookAge,
      research: decisions.get(q.marketId) ?? null,
      researchCollectedAt: frame.decisionAt,
      coverage: coverage.get(q.marketId)?.status ?? "unavailable",
      failures: [...failures],
      executionQuoteCurrent: priceAge !== null && priceAge <= 30 && bookAge !== null && bookAge <= 15 && Boolean(quoteAligned),
      executionAuthorized: false,
    };
  });
  return { version: "coinapi-shared-read-v1", authority: "research_only", provider: "coinapi",
    collectedAt: frame.decisionAt, publicationAgeSeconds: ageSeconds(frame.decisionAt, now),
    researchIntervalSeconds: 60, executionAuthorized: false, publicRankingChanged: false,
    marketCount: markets.length, markets };
}
