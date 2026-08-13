import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { getCanonicalMomentumMagnitude, getSpotMomentumStrategyScore } from "./canonical-momentum.ts";

test("full-day leaders retain magnitude authority when below the regular-session open", () => {
  const fullDayLeader = getCanonicalMomentumMagnitude({ change: 101.78 });
  const smallerAlignedMove = getCanonicalMomentumMagnitude({ change: 22.37 });

  assert.equal(fullDayLeader, 100);
  assert.equal(smallerAlignedMove, 67.11);
  assert.ok(fullDayLeader > smallerAlignedMove);
});

test("current-session context cannot manufacture positive full-day magnitude", () => {
  assert.equal(getCanonicalMomentumMagnitude({ change: -14 }), 0);
  assert.equal(getCanonicalMomentumMagnitude({ change: 0 }), 0);
});

test("today's stronger qualified leaders outrank the smaller aligned move", () => {
  const nmtc = getSpotMomentumStrategyScore({
    change: 22.3684,
    breakoutScore: 75,
    qualityScore: 78,
    sessionAlignmentAdjustment: 4,
    proxMarketAdjustment: 11,
  });
  const dfsc = getSpotMomentumStrategyScore({
    change: 101.7823,
    breakoutScore: 78,
    qualityScore: 84,
    sessionAlignmentAdjustment: -2,
    proxMarketAdjustment: 5,
  });
  const limn = getSpotMomentumStrategyScore({
    change: 53.3641,
    breakoutScore: 77,
    qualityScore: 85,
    sessionAlignmentAdjustment: 4,
    proxMarketAdjustment: -6,
  });

  assert.equal(nmtc, 87);
  assert.equal(dfsc, 93);
  assert.equal(limn, 88);
  assert.ok(dfsc > limn && limn > nmtc);
});
