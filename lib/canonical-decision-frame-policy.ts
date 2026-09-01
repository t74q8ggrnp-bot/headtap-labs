// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { ACTIVE_MARKET_DATA_MAX_AGE_MS, isActiveMarketTimestampUsable, marketTimestampMs } from "./market-data-time.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { PROX_UNAVAILABLE_MARKET_ADJUSTMENT } from "./prox/public-authority.ts";

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
  scoreContext?: {
    proxMarketDataAligned?: unknown;
    proxMarketAdjustment?: unknown;
    proxSupportsContinuation?: unknown;
    peakFailureConfirmed?: unknown;
    proxDeepSessionRecoveryWithheld?: unknown;
    proxSevereSessionPeakDamage?: unknown;
  } | null;
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
      decisionQuoteMs === null
    ) {
      return { fresh: false, freshUntil: null };
    }
    const proxTemporalAuthorityReady = Boolean(
      isActiveMarketTimestampUsable(
        record.proxIntelligence?.pulse?.marketAsOf,
        now,
      ) &&
        record.scoreContext?.proxMarketDataAligned === true &&
        proxMarketMs !== null,
    );
    // The provider-time contract permits a missing/stale/misaligned pulse only
    // through the documented fail-closed lane: the exact bounded penalty is
    // applied, while support and every defensive authority action remain off.
    // This is not a neutral pass and stale ProX facts still cannot act.
    const proxFailClosed = Boolean(
      Number(record.scoreContext?.proxMarketAdjustment) ===
        PROX_UNAVAILABLE_MARKET_ADJUSTMENT &&
        record.scoreContext?.proxSupportsContinuation === false &&
        record.scoreContext?.peakFailureConfirmed === false &&
        record.scoreContext?.proxDeepSessionRecoveryWithheld === false &&
        record.scoreContext?.proxSevereSessionPeakDamage === false,
    );
    if (!proxTemporalAuthorityReady && !proxFailClosed) {
      return { fresh: false, freshUntil: null };
    }
    const recordExpiryMs = proxTemporalAuthorityReady
      ? Math.min(
          decisionQuoteMs + ACTIVE_MARKET_DATA_MAX_AGE_MS,
          (proxMarketMs as number) + ACTIVE_MARKET_DATA_MAX_AGE_MS,
        )
      : decisionQuoteMs + ACTIVE_MARKET_DATA_MAX_AGE_MS;
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
