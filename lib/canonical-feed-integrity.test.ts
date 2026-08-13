import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { auditCanonicalSpotMomentumFeed } from "./canonical-feed-integrity.ts";

const qualified = (ticker: string, change: number) => ({
  ticker,
  price: 10,
  displayPrice: 10,
  change,
  displayChange: change,
  displayEligibility: { eligible: true },
  momentumRadarEligible: false,
  visibilityState: "canonical",
  tradeFramework: { hardFailures: [] },
  scoreContext: { peakFailureConfirmed: false },
});

test("accepts one atomic qualified ranking and a separate no-entry radar", () => {
  const hero = qualified("HERO", 20);
  const contender = qualified("NEXT", 12);
  const radar = {
    ...qualified("RADR", 15),
    displayEligibility: { eligible: false },
    momentumRadarEligible: true,
    visibilityState: "momentum_radar",
  };
  const audit = auditCanonicalSpotMomentumFeed({
    opportunities: [hero, contender],
    momentumContenders: [contender],
    momentumRadar: [radar],
  });
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.issues, []);
});

test("rejects a post-ranking quote flip and radar mixed into contenders", () => {
  const hero = qualified("HERO", 20);
  const flipped = {
    ...qualified("FLIP", 4),
    displayChange: -1,
  };
  const mixedRadar = {
    ...qualified("RADR", 15),
    displayEligibility: { eligible: false },
    momentumRadarEligible: true,
    visibilityState: "momentum_radar",
  };
  const audit = auditCanonicalSpotMomentumFeed({
    opportunities: [hero, flipped],
    momentumContenders: [mixedRadar],
    momentumRadar: [],
  });
  assert.equal(audit.ok, false);
  assert.ok(
    audit.issues.some(
      (issue) => issue.code === "decision_display_change_mismatch",
    ),
  );
  assert.ok(
    audit.issues.some(
      (issue) => issue.code === "radar_mixed_into_qualified_set",
    ),
  );
});

test("rejects a visible conventional setup that still has a hard failure", () => {
  const broken = {
    ...qualified("BSEM", 8),
    tradeFramework: {
      hardFailures: ["R:R 0.34 is below the 1.0 hard floor."],
    },
  };
  const audit = auditCanonicalSpotMomentumFeed({
    opportunities: [broken],
    momentumContenders: [],
    momentumRadar: [],
  });
  assert.equal(audit.ok, false);
  assert.ok(
    audit.issues.some((issue) => issue.code === "hard_failure_visible"),
  );
});
