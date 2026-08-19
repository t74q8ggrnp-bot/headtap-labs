import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension while the production bundler resolves the same module extensionless.
import { enforceSpotMomentumAuthority, getPriceDiscoveryEntryRejection, isSpotMomentumEntryTimingOnlyRejection, POSITIVE_FULL_DAY_MOMENTUM_REQUIRED, preserveDisplayHardFailures, PROX_PEAK_FAILURE_BLOCK } from "./spot-momentum-authority.ts";

test("rejects a strong bounce that remains negative versus the previous close", () => {
  const reasons = enforceSpotMomentumAuthority({
    rejectionReasons: [],
    fullDayChangePercent: -19.47,
    peakFailureConfirmed: false,
  });
  assert.deepEqual(reasons, [POSITIVE_FULL_DAY_MOMENTUM_REQUIRED]);
});

test("confirmed ProX peak failure is a blocking authority decision", () => {
  const reasons = enforceSpotMomentumAuthority({
    rejectionReasons: [],
    fullDayChangePercent: 20,
    peakFailureConfirmed: true,
  });
  assert.deepEqual(reasons, [PROX_PEAK_FAILURE_BLOCK]);
});

test("price-discovery visibility never erases a real R:R failure", () => {
  const priceDiscontinuity =
    "Live price is inconsistent with recent adjusted history (80% deviation).";
  const rrFailure = "R:R 0.34 is below the 1.0 hard floor.";
  const displayReasons = preserveDisplayHardFailures(
    [priceDiscontinuity, rrFailure, "Reward magnitude is negligible."],
    priceDiscontinuity,
  );
  assert.deepEqual(displayReasons, [
    rrFailure,
    "Reward magnitude is negligible.",
  ]);
});

test("BSEM-shaped inputs retain every blocking reason", () => {
  const rrFailure = "R:R 0.34 is below the 1.0 hard floor.";
  const authorityReasons = enforceSpotMomentumAuthority({
    rejectionReasons: [rrFailure, "Reward magnitude is negligible."],
    fullDayChangePercent: -19.47,
    peakFailureConfirmed: true,
  });
  const displayReasons = preserveDisplayHardFailures(authorityReasons, null);

  assert.deepEqual(displayReasons, [
    rrFailure,
    "Reward magnitude is negligible.",
    POSITIVE_FULL_DAY_MOMENTUM_REQUIRED,
    PROX_PEAK_FAILURE_BLOCK,
  ]);
});

test("price discovery below 1:1 becomes an entry-timing rejection", () => {
  const reason = getPriceDiscoveryEntryRejection({
    state: "price_discovery",
    scenarioBands: { expansionRr: 0.8 },
  });
  assert.equal(
    reason,
    "Price discovery scenario R:R 0.80 is below the 1.0 entry floor.",
  );
  assert.equal(
    isSpotMomentumEntryTimingOnlyRejection(reason ?? ""),
    true,
  );
});

test("price discovery at or above 1:1 clears the scenario entry floor", () => {
  assert.equal(
    getPriceDiscoveryEntryRejection({
      state: "price_discovery",
      scenarioBands: { expansionRr: 1 },
    }),
    null,
  );
});

// Reversed 2026-08-19: an unmeasurable ratio and a bad ratio are different
// things. A null scenario is structurally the common case for the biggest,
// most extended, most-confirmed movers (framework.downsideRisk is null
// because the move blew past the historical-deviation check before a
// support level was ever computed) — rejecting on "unknown" the same way as
// "known and bad" was blocking most of a session's real top movers. Only a
// real, computed ratio below the floor should reject; an unmeasurable one
// should not.
test("price discovery without a measurable structural-risk scenario is not rejected on that basis alone", () => {
  assert.equal(
    getPriceDiscoveryEntryRejection({
      state: "price_discovery",
      scenarioBands: null,
    }),
    null,
  );
});

test("price discovery with a scenario but no computable ratio is not rejected on that basis alone", () => {
  assert.equal(
    getPriceDiscoveryEntryRejection({
      state: "price_discovery",
      scenarioBands: { expansionRr: null },
    }),
    null,
  );
});
