import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension while the production bundler resolves the same module extensionless.
import { enforceSpotMomentumAuthority, POSITIVE_FULL_DAY_MOMENTUM_REQUIRED, preserveDisplayHardFailures, PROX_PEAK_FAILURE_BLOCK } from "./spot-momentum-authority.ts";

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
