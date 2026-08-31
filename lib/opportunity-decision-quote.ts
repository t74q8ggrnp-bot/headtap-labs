import type { OpportunityCandidate } from "@/lib/canonical-opportunity";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { ACTIVE_MARKET_DATA_MAX_AGE_MS, isActiveMarketTimestampUsable } from "./market-data-time.ts";

export const ACTIVE_DECISION_QUOTE_MAX_AGE_MS =
  ACTIVE_MARKET_DATA_MAX_AGE_MS;

export type OpportunityDecisionQuote = {
  price: number;
  change: number;
  asOf: string;
};

const ACTIVE_QUOTE_SESSIONS = new Set([
  "pre_market",
  "regular",
  "after_hours",
]);

function isFinitePositive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isUsableDecisionQuote(
  candidate: OpportunityCandidate,
  quote: OpportunityDecisionQuote | null | undefined,
  now: Date,
) {
  if (
    !quote ||
    !isFinitePositive(quote.price) ||
    !Number.isFinite(quote.change)
  ) {
    return false;
  }

  if (!ACTIVE_QUOTE_SESSIONS.has(candidate.scanSession)) return true;

  return isActiveMarketTimestampUsable(
    quote.asOf,
    now,
    ACTIVE_DECISION_QUOTE_MAX_AGE_MS,
  );
}

/**
 * Apply one authoritative quote before framework evaluation and ranking.
 * Session context is recomputed from the same price so price, movement,
 * pullback, scoring, and display can never describe different snapshots.
 */
export function applyOpportunityDecisionQuote(
  candidate: OpportunityCandidate,
  quote: OpportunityDecisionQuote | null | undefined,
  now = new Date(),
): OpportunityCandidate {
  if (!isUsableDecisionQuote(candidate, quote, now) || !quote) {
    return {
      ...candidate,
      decisionQuoteLive: false,
      decisionQuoteAsOf: candidate.sourceMarketDataAsOf,
    };
  }

  const sessionOpen = candidate.sessionOpenPrice;
  const sessionHigh = Math.max(
    candidate.sessionHighPrice ?? 0,
    quote.price,
  );
  const changeFromOpenPercent =
    sessionOpen !== null && sessionOpen > 0
      ? ((quote.price - sessionOpen) / sessionOpen) * 100
      : candidate.changeFromOpenPercent;
  const pullbackFromSessionHighPercent =
    sessionHigh > 0
      ? Math.max(0, ((sessionHigh - quote.price) / sessionHigh) * 100)
      : candidate.pullbackFromSessionHighPercent;

  return {
    ...candidate,
    price: quote.price,
    change: quote.change,
    changeFromOpenPercent,
    sessionHighPrice: sessionHigh > 0 ? sessionHigh : null,
    pullbackFromSessionHighPercent,
    // A closed-session quote can still improve the retained verified price,
    // but processing it now must never relabel old market data as "Live".
    decisionQuoteLive: ACTIVE_QUOTE_SESSIONS.has(candidate.scanSession),
    decisionQuoteAsOf: quote.asOf,
  };
}
