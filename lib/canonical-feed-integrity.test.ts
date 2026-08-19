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

test("accepts one atomic ranking with an entry-withheld overall contender", () => {
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
    momentumContenders: [radar, contender],
    momentumRadar: [],
  });
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.issues, []);
});

test("rejects a post-ranking quote flip and invalid contender authority", () => {
  const hero = qualified("HERO", 20);
  const flipped = {
    ...qualified("FLIP", 4),
    displayChange: -1,
  };
  const mixedRadar = {
    ...qualified("RADR", 15),
    displayEligibility: { eligible: false },
    momentumRadarEligible: false,
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
      (issue) => issue.code === "invalid_contender_authority",
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

test("rejects an entry-qualified price-discovery record below 1:1 scenario R:R", () => {
  const broken = {
    ...qualified("SPAI", 32.8),
    visibilityState: "canonical",
    explosionAssessment: {
      state: "price_discovery",
      scenarioBands: { expansionRr: 0.8 },
    },
  };
  const audit = auditCanonicalSpotMomentumFeed({
    opportunities: [broken],
    momentumContenders: [],
    momentumRadar: [],
  });
  assert.equal(audit.ok, false);
  assert.ok(
    audit.issues.some(
      (issue) =>
        issue.code === "price_discovery_entry_floor_violation",
    ),
  );
});

// 2026-08-19: an entry-qualified price-discovery record with an unmeasurable
// (not a bad, just unknown) scenario ratio is no longer a violation —
// getPriceDiscoveryEntryRejection stopped blocking entry on that basis, so
// this check has to agree, or every legitimately-passing candidate with no
// downsideRisk yet (the biggest, most extended movers) trips a false alarm.
test("does not flag an entry-qualified price-discovery record with an unmeasurable scenario ratio", () => {
  const passing = {
    ...qualified("YJ", 236.2),
    visibilityState: "verified_price_discovery",
    explosionAssessment: {
      state: "price_discovery",
      scenarioBands: { expansionRr: null },
    },
  };
  const audit = auditCanonicalSpotMomentumFeed({
    opportunities: [passing],
    momentumContenders: [],
    momentumRadar: [],
  });
  assert.equal(
    audit.issues.some(
      (issue) => issue.code === "price_discovery_entry_floor_violation",
    ),
    false,
  );
});
