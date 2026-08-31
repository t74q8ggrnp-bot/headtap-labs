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
} from "@/lib/canonical-decision-frame-policy";

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
  const payload = cachedFreshness.fresh && cachedMarketTiming.fresh
    ? cached
    : await buildFullFrame(requestedType);
  const decisionAsOf = "timestamp" in payload
    ? payload.timestamp
    : new Date().toISOString();
  const freshness = getDecisionFrameFreshness(decisionAsOf);
  const marketTiming = getDecisionFrameMarketTimingFreshness(payload);
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
    : freshness.freshUntil;

  return {
    ...payload,
    decisionFrame: {
      version: CANONICAL_DECISION_FRAME_VERSION,
      decisionAsOf,
      presentedAt: new Date().toISOString(),
      freshUntil: strictFreshUntil,
      ageSeconds: Number.isFinite(freshness.ageSeconds)
        ? Number(freshness.ageSeconds.toFixed(1))
        : null,
      maxAgeSeconds: CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS,
      fresh: freshness.fresh && marketTiming.fresh,
      staleCacheBypassed:
        !cachedFreshness.fresh || !cachedMarketTiming.fresh,
    },
  };
}

export { findOpportunityInDecisionFrame } from "@/lib/canonical-decision-frame-policy";
