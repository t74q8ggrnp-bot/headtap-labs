import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS, findOpportunityInDecisionFrame, getDecisionFrameFreshness } from "./canonical-decision-frame-policy.ts";

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
