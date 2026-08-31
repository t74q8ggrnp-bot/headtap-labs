import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS, findOpportunityInDecisionFrame, getDecisionFrameFreshness, getDecisionFrameMarketTimingFreshness } from "./canonical-decision-frame-policy.ts";

test("rolling decision frames expire after the strict active-session window", () => {
  const now = new Date("2026-08-14T15:35:00.000Z");
  assert.equal(
    getDecisionFrameFreshness(
      new Date(
        now.getTime() -
          (CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS - 1) * 1_000,
      ).toISOString(),
      now,
    ).fresh,
    true,
  );
  assert.equal(
    getDecisionFrameFreshness(
      new Date(
        now.getTime() -
          (CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS + 1) * 1_000,
      ).toISOString(),
      now,
    ).fresh,
    false,
  );
});

test("ticker detail resolves the exact contender object from the shared frame", () => {
  const contender = { ticker: "MDXH", opportunityScore: 98 };
  const frame = {
    opportunities: [{ ticker: "LFS", opportunityScore: 91 }],
    momentumContenders: [contender],
    momentumRadar: [{ ticker: "HHS", opportunityScore: 66 }],
  };
  assert.equal(findOpportunityInDecisionFrame(frame, "mdxh"), contender);
});

test("a cached frame expires when its provider-time evidence expires", () => {
  const now = new Date("2026-08-31T13:41:00.000Z");
  const base = {
    scanSession: "regular",
    decisionQuoteAsOf: "2026-08-31T13:39:00.000Z",
    proxIntelligence: {
      pulse: { marketAsOf: "2026-08-31T13:38:00.000Z" },
    },
    scoreContext: { proxMarketDataAligned: true },
  };
  const fresh = getDecisionFrameMarketTimingFreshness(
    { opportunities: [base], momentumContenders: [] },
    now,
  );
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.freshUntil, "2026-08-31T13:43:00.000Z");

  const expired = getDecisionFrameMarketTimingFreshness(
    {
      opportunities: [
        {
          ...base,
          proxIntelligence: {
            pulse: { marketAsOf: "2026-08-31T13:35:59.000Z" },
          },
        },
      ],
      momentumContenders: [],
    },
    now,
  );
  assert.equal(expired.fresh, false);
  assert.equal(expired.freshUntil, null);

  const failClosed = getDecisionFrameMarketTimingFreshness(
    {
      opportunities: [
        {
          ...base,
          proxIntelligence: null,
          scoreContext: {
            proxMarketDataAligned: false,
            proxMarketAdjustment: -8,
            proxSupportsContinuation: false,
            peakFailureConfirmed: false,
            proxDeepSessionRecoveryWithheld: false,
            proxSevereSessionPeakDamage: false,
          },
        },
      ],
      momentumContenders: [],
    },
    now,
  );
  assert.equal(failClosed.fresh, true);
  assert.equal(failClosed.freshUntil, "2026-08-31T13:44:00.000Z");
});
