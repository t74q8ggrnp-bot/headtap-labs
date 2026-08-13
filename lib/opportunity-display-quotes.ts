import "server-only";

import {
  resolveSnapshotChangePercent,
  resolveSnapshotDisplayPrice,
  resolveSnapshotTimestampMs,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import type { OpportunityDecisionQuote } from "@/lib/opportunity-decision-quote";

export type OpportunityDisplayQuote = OpportunityDecisionQuote;

type OpportunityWithDisplayFields = {
  ticker?: unknown;
  price?: unknown;
  change?: unknown;
  displayChange?: unknown;
  decisionQuoteLive?: unknown;
  decisionQuoteAsOf?: unknown;
};

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Load one server-owned market quote snapshot. Canonical feeds apply these
 * quotes before scoring and reuse the identical map for display; ticker detail
 * follows the same path. Rows without a real market timestamp fail closed.
 */
export async function loadOpportunityDisplayQuotes(
  symbols: string[],
): Promise<Map<string, OpportunityDisplayQuote>> {
  const apiKey = process.env.POLYGON_API_KEY;
  const uniqueSymbols = [...new Set(
    symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  )];
  const quotes = new Map<string, OpportunityDisplayQuote>();
  if (!apiKey || uniqueSymbols.length === 0) return quotes;

  for (let index = 0; index < uniqueSymbols.length; index += 100) {
    const batch = uniqueSymbols.slice(index, index + 100);
    const url =
      "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers" +
      `?tickers=${encodeURIComponent(batch.join(","))}` +
      `&apiKey=${encodeURIComponent(apiKey)}`;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload: unknown = await response.json();
      const rows =
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { tickers?: unknown }).tickers)
          ? ((payload as { tickers: PolygonSnapshotRow[] }).tickers)
          : [];
      for (const row of rows) {
        const ticker = String(row.ticker ?? "").trim().toUpperCase();
        const price = resolveSnapshotDisplayPrice(row);
        const change = resolveSnapshotChangePercent(row, price);
        if (!ticker || price <= 0 || !Number.isFinite(change)) continue;
        const marketTimestamp = resolveSnapshotTimestampMs(row);
        if (marketTimestamp === null) continue;
        const asOf = new Date(marketTimestamp).toISOString();
        quotes.set(ticker, { price, change, asOf });
      }
    } catch {
      // A quote outage must not erase an otherwise valid canonical decision.
      // The caller will retain the promoted run's price and percentage.
    }
  }

  return quotes;
}

export function attachOpportunityDisplayQuote<
  T extends OpportunityWithDisplayFields,
>(
  opportunity: T,
  quotes: Map<string, OpportunityDisplayQuote>,
): T & {
  displayPrice: number;
  displayChange: number;
  displayQuoteLive: boolean;
  displayQuoteAsOf: string | null;
} {
  const ticker = String(opportunity.ticker ?? "").trim().toUpperCase();
  const quote = quotes.get(ticker);
  const canonicalPrice = finiteNumber(opportunity.price) ?? 0;
  const canonicalChange =
    finiteNumber(opportunity.displayChange) ??
    finiteNumber(opportunity.change) ??
    0;
  const decisionQuoteLive = opportunity.decisionQuoteLive === true;
  const quoteWasRejectedForDecision =
    opportunity.decisionQuoteLive === false;
  const authoritativeQuote = quoteWasRejectedForDecision ? undefined : quote;
  const decisionQuoteAsOf =
    typeof opportunity.decisionQuoteAsOf === "string"
      ? opportunity.decisionQuoteAsOf
      : null;

  return {
    ...opportunity,
    displayPrice: authoritativeQuote?.price ?? canonicalPrice,
    displayChange: authoritativeQuote?.change ?? canonicalChange,
    displayQuoteLive: Boolean(authoritativeQuote) || decisionQuoteLive,
    displayQuoteAsOf: authoritativeQuote?.asOf ?? decisionQuoteAsOf,
  };
}
