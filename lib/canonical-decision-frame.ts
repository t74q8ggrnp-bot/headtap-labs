import "server-only";

import { unstable_cache } from "next/cache";
import {
  buildCanonicalOpportunityFeed,
  type OpportunityFeedRequestType,
} from "@/lib/canonical-opportunity-feed";
import {
  CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS,
  CANONICAL_DECISION_FRAME_REVALIDATE_SECONDS,
  CANONICAL_DECISION_FRAME_VERSION,
  getDecisionFrameFreshness,
  getDecisionFrameMarketTimingFreshness,
  getRetainedSessionIntegrity,
  presentCanonicalSessionRecord,
} from "@/lib/canonical-decision-frame-policy";
import { getStockMarketClock } from "@/lib/stock-market-session";

type RollingFrameType = Extract<
  OpportunityFeedRequestType,
  "momentum" | "before_crowd"
>;

async function buildFullFrame(requestedType: RollingFrameType) {
  return buildCanonicalOpportunityFeed({
    requestedType,
    limit: 100,
    debug: true,
    includeContinuation: true,
  });
}

const getCachedMomentumFrame = unstable_cache(
  async () => buildFullFrame("momentum"),
  [CANONICAL_DECISION_FRAME_VERSION, "momentum"],
  {
    revalidate: CANONICAL_DECISION_FRAME_REVALIDATE_SECONDS,
    tags: ["canonical-opportunities", "canonical-opportunities-momentum"],
  },
);

const getCachedBeforeCrowdFrame = unstable_cache(
  async () => buildFullFrame("before_crowd"),
  [CANONICAL_DECISION_FRAME_VERSION, "before_crowd"],
  {
    revalidate: CANONICAL_DECISION_FRAME_REVALIDATE_SECONDS,
    tags: ["canonical-opportunities", "canonical-opportunities-before-crowd"],
  },
);

export async function getRollingCanonicalDecisionFrame(
  requestedType: RollingFrameType,
) {
  const cached = requestedType === "momentum"
    ? await getCachedMomentumFrame()
    : await getCachedBeforeCrowdFrame();
  const cachedTimestamp = "timestamp" in cached ? cached.timestamp : null;
  const cachedFreshness = getDecisionFrameFreshness(cachedTimestamp);
  const cachedMarketTiming = getDecisionFrameMarketTimingFreshness(cached);
  const cachedRetention = getRetainedSessionIntegrity(cached);
  const useCached = cachedFreshness.fresh && (cachedMarketTiming.fresh || cachedRetention.valid);
  const payload = useCached
    ? cached
    : await buildFullFrame(requestedType);
  const decisionAsOf = "timestamp" in payload
    ? payload.timestamp
    : null;
  const now = new Date();
  const freshness = getDecisionFrameFreshness(decisionAsOf, now);
  const marketTiming = getDecisionFrameMarketTimingFreshness(payload, now);
  const retainedSession = getRetainedSessionIntegrity(payload, now);
  const currentSession = getStockMarketClock(now).session;
  const frameFreshUntilMs = freshness.freshUntil
    ? new Date(freshness.freshUntil).getTime()
    : NaN;
  const marketFreshUntilMs = marketTiming.freshUntil
    ? new Date(marketTiming.freshUntil).getTime()
    : NaN;
  const strictFreshUntil = Number.isFinite(marketFreshUntilMs)
    ? new Date(
        Number.isFinite(frameFreshUntilMs)
          ? Math.min(frameFreshUntilMs, marketFreshUntilMs)
          : marketFreshUntilMs,
      ).toISOString()
    : null;

  return {
    ...payload,
    opportunities: payload.opportunities.map(record => presentCanonicalSessionRecord(record, now)),
    ...("momentumContenders" in payload ? {
      momentumContenders: payload.momentumContenders.map(record => presentCanonicalSessionRecord(record, now)),
      momentumRadar: payload.momentumRadar.map(record => presentCanonicalSessionRecord(record, now)),
    } : {}),
    decisionFrame: {
      version: CANONICAL_DECISION_FRAME_VERSION,
      decisionAsOf,
      presentedAt: now.toISOString(),
      freshUntil: strictFreshUntil,
      ageSeconds: Number.isFinite(freshness.ageSeconds)
        ? Number(freshness.ageSeconds.toFixed(1))
        : null,
      maxAgeSeconds: CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS,
      fresh: freshness.fresh && marketTiming.fresh,
      status: currentSession === "closed"
        ? retainedSession.valid ? "last_session" : "unavailable"
        : freshness.fresh && marketTiming.fresh ? "live" : "stale",
      currentSession,
      retainedSession,
      staleCacheBypassed: !useCached,
    },
  };
}

export { findOpportunityInDecisionFrame } from "@/lib/canonical-decision-frame-policy";
