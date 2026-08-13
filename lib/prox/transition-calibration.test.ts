import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension while the production bundler resolves the same module extensionless.
import { buildProxTransitionCalibrations, buildProxTransitionProfile, selectProxTransitionComparisonEvidence } from "./transition-calibration.ts";

const profile = buildProxTransitionProfile({
  marketSession: "pre_market",
  price: 0.6,
  relativeVolume: 8.4,
  momentumScore: 71,
  crowdScore: 42,
  trapScore: 20,
  opportunityScore: 67,
});

test("uses every finalized Before The Crowd case as the denominator", () => {
  const cases = Array.from({ length: 100 }, (_, index) => ({
    profile,
    graduatedToSpot: index < 20,
    transitionMinutes: index < 20 ? 65 : null,
    maxGainPercent: index < 10 ? 120 : index < 50 ? 25 : 5,
    maxDrawdownPercent: index >= 80 ? -15 : -4,
    timeToPeakMinutes: 90,
  }));
  const calibrations = buildProxTransitionCalibrations(cases);
  const evidence = selectProxTransitionComparisonEvidence(
    profile,
    calibrations,
  );

  assert.ok(evidence);
  assert.equal(evidence.evidenceState, "calibrated");
  assert.equal(evidence.sampleSize, 100);
  assert.equal(evidence.graduatedCount, 20);
  assert.equal(evidence.graduationRate, 0.2);
  assert.equal(evidence.explosionRate, 0.1);
  assert.equal(evidence.continuationRate, 0.5);
  assert.equal(evidence.failureRate, 0.2);
});

test("keeps a 29-case cohort explicitly insufficient", () => {
  const cases = Array.from({ length: 29 }, () => ({
    profile,
    graduatedToSpot: true,
    transitionMinutes: 45,
    maxGainPercent: 35,
    maxDrawdownPercent: -5,
    timeToPeakMinutes: 80,
  }));
  const evidence = selectProxTransitionComparisonEvidence(
    profile,
    buildProxTransitionCalibrations(cases),
  );

  assert.ok(evidence);
  assert.equal(evidence.evidenceState, "insufficient");
  assert.match(evidence.summary, /cannot influence the HT score/);
  assert.equal(evidence.publicScoreAuthority, false);
});

test("backs off to an emerging broader cohort instead of inventing exact confidence", () => {
  const differentPriceProfile = buildProxTransitionProfile({
    marketSession: "pre_market",
    price: 8,
    relativeVolume: 8.4,
    momentumScore: 71,
    crowdScore: 42,
    trapScore: 20,
    opportunityScore: 67,
  });
  const cases = [
    ...Array.from({ length: 10 }, () => ({
      profile,
      graduatedToSpot: true,
      transitionMinutes: 60,
      maxGainPercent: 30,
      maxDrawdownPercent: -4,
      timeToPeakMinutes: 90,
    })),
    ...Array.from({ length: 25 }, () => ({
      profile: differentPriceProfile,
      graduatedToSpot: false,
      transitionMinutes: null,
      maxGainPercent: 8,
      maxDrawdownPercent: -3,
      timeToPeakMinutes: 70,
    })),
  ];
  const evidence = selectProxTransitionComparisonEvidence(
    profile,
    buildProxTransitionCalibrations(cases),
  );

  assert.ok(evidence);
  assert.equal(evidence.evidenceState, "emerging");
  assert.equal(evidence.cohortLevel, "behavior_profile");
  assert.equal(evidence.sampleSize, 35);
});

test("keeps missing early features unknown instead of turning null into zero", () => {
  const missing = buildProxTransitionProfile({
    marketSession: null,
    price: 3,
    relativeVolume: null,
    momentumScore: null,
    crowdScore: null,
    trapScore: null,
    opportunityScore: 55,
  });

  assert.equal(missing.marketSession, "unknown");
  assert.equal(missing.relativeVolumeBucket, "unknown");
  assert.equal(missing.momentumBucket, "unknown");
  assert.equal(missing.crowdBucket, "unknown");
  assert.equal(missing.trapBucket, "unknown");
});
