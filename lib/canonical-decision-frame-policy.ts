import {
  ACTIVE_MARKET_DATA_MAX_AGE_MS,
  isActiveMarketTimestampUsable,
  marketTimestampMs,
} from "./market-data-time";

export const CANONICAL_DECISION_FRAME_VERSION =
  "rolling-canonical-decision-frame-v4-source-time-authority";
export const CANONICAL_DECISION_FRAME_REVALIDATE_SECONDS = 60;
export const CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS = 90;

export function getDecisionFrameFreshness(
  decisionAsOf: string | null | undefined,
  now = new Date(),
) {
  const decisionMs = decisionAsOf ? new Date(decisionAsOf).getTime() : NaN;
  const ageSeconds = Number.isFinite(decisionMs)
    ? Math.max(0, (now.getTime() - decisionMs) / 1_000)
    : Number.POSITIVE_INFINITY;
  return {
    ageSeconds,
    fresh: ageSeconds <= CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS,
    freshUntil: Number.isFinite(decisionMs)
      ? new Date(
          decisionMs + CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS * 1_000,
        ).toISOString()
      : null,
  };
}

type MarketTimedFrameOpportunity = {
  scanSession?: unknown;
  decisionQuoteAsOf?: unknown;
  proxIntelligence?: {
    pulse?: { marketAsOf?: unknown } | null;
  } | null;
  scoreContext?: { proxMarketDataAligned?: unknown } | null;
};

const ACTIVE_MARKET_SESSIONS = new Set([
  "pre_market",
  "regular",
  "after_hours",
]);

export function getDecisionFrameMarketTimingFreshness(
  frame: {
    opportunities?: unknown;
    momentumContenders?: unknown;
  },
  now = new Date(),
) {
  const records = [
    Array.isArray(frame.opportunities) ? frame.opportunities[0] : null,
    ...(Array.isArray(frame.momentumContenders)
      ? frame.momentumContenders
      : []),
  ].filter(Boolean) as MarketTimedFrameOpportunity[];
  let earliestExpiryMs: number | null = null;

  for (const record of records) {
    if (!ACTIVE_MARKET_SESSIONS.has(String(record.scanSession ?? ""))) {
      continue;
    }
    const decisionQuoteMs = marketTimestampMs(record.decisionQuoteAsOf);
    const proxMarketMs = marketTimestampMs(
      record.proxIntelligence?.pulse?.marketAsOf,
    );
    if (
      !isActiveMarketTimestampUsable(record.decisionQuoteAsOf, now) ||
      !isActiveMarketTimestampUsable(
        record.proxIntelligence?.pulse?.marketAsOf,
        now,
      ) ||
      record.scoreContext?.proxMarketDataAligned !== true ||
      decisionQuoteMs === null ||
      proxMarketMs === null
    ) {
      return { fresh: false, freshUntil: null };
    }
    const recordExpiryMs = Math.min(
      decisionQuoteMs + ACTIVE_MARKET_DATA_MAX_AGE_MS,
      proxMarketMs + ACTIVE_MARKET_DATA_MAX_AGE_MS,
    );
    earliestExpiryMs =
      earliestExpiryMs === null
        ? recordExpiryMs
        : Math.min(earliestExpiryMs, recordExpiryMs);
  }

  return {
    fresh: true,
    freshUntil:
      earliestExpiryMs === null
        ? null
        : new Date(earliestExpiryMs).toISOString(),
  };
}

type FrameOpportunity = { ticker?: unknown } & Record<string, unknown>;

export function findOpportunityInDecisionFrame(
  frame: {
    opportunities?: unknown;
    momentumContenders?: unknown;
    momentumRadar?: unknown;
  },
  ticker: string,
) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const collections = [
    frame.opportunities,
    frame.momentumContenders,
    frame.momentumRadar,
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    const match = (collection as FrameOpportunity[]).find(
      (opportunity) =>
        String(opportunity.ticker ?? "").trim().toUpperCase() ===
        normalizedTicker,
    );
    if (match) return match;
  }
  return null;
}
