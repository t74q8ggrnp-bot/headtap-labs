import type { OpportunityCandidate } from "@/lib/canonical-opportunity";

export const ACTIVE_DECISION_QUOTE_MAX_AGE_MS = 20 * 60 * 1000;

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

  const timestamp = new Date(quote.asOf).getTime();
  const ageMs = now.getTime() - timestamp;
  return (
    Number.isFinite(timestamp) &&
    ageMs >= -5 * 60 * 1000 &&
    ageMs <= ACTIVE_DECISION_QUOTE_MAX_AGE_MS
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
      decisionQuoteAsOf: null,
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
    decisionQuoteLive: true,
    decisionQuoteAsOf: quote.asOf,
  };
}
