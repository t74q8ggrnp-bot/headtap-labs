import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source
// extension while the production bundler resolves the same module extensionless.
import { buildProxCanonicalTransitionCase } from "./transition-memory.ts";

test("preserves the audited PLAG Before The Crowd to Spot Momentum transition", () => {
  const result = buildProxCanonicalTransitionCase({
    ticker: "PLAG",
    tradingDate: "2026-08-10",
    beforeCrowd: {
      observedAt: "2026-08-10T10:49:00.000Z",
      price: 0.6,
      role: "contender",
      rank: 2,
      score: 67,
      decisionSnapshot: {
        scanSession: "pre_market",
        relativeVolume: 8.4,
        momentumScore: 71,
      },
    },
    spotMomentum: {
      observedAt: "2026-08-10T11:54:00.000Z",
      price: 0.97,
      role: "hero",
      rank: 1,
      score: 92,
      decisionSnapshot: {
        scanSession: "pre_market",
        relativeVolume: 25,
        momentumScore: 96,
      },
    },
    outcome: {
      highestPrice: 6.35,
      highestAt: "2026-08-10T18:16:00.000Z",
      lowestPrice: 0.6,
      lowestAt: "2026-08-10T10:49:00.000Z",
    },
  });

  assert.ok(result);
  assert.equal(result.transitionMinutes, 65);
  assert.equal(result.transitionReturnPercent, 61.667);
  assert.equal(result.maxGainFromEarlyPercent, 958.333);
  assert.equal(result.maxGainFromSpotPercent, 554.639);
  assert.equal(result.caseLabel, "before_crowd_to_spot_explosion");
  assert.equal(result.caseFingerprint.sourceKind, "canonical_transition_case");
  assert.equal(result.caseFingerprint.publicScoreAuthority, false);
});

test("labels a weak transition with a deep adverse excursion as a failure", () => {
  const result = buildProxCanonicalTransitionCase({
    ticker: "TEST",
    tradingDate: "2026-08-10",
    beforeCrowd: {
      observedAt: "2026-08-10T12:00:00.000Z",
      price: 10,
      role: "contender",
      rank: 3,
      score: 62,
    },
    spotMomentum: {
      observedAt: "2026-08-10T12:30:00.000Z",
      price: 10.2,
      role: "contender",
      rank: 5,
      score: 66,
    },
    outcome: {
      highestPrice: 10.5,
      lowestPrice: 8.5,
    },
  });

  assert.ok(result);
  assert.equal(result.maxGainFromEarlyPercent, 5);
  assert.equal(result.maxDrawdownFromEarlyPercent, -15);
  assert.equal(result.caseLabel, "before_crowd_to_spot_failure");
});

test("rejects reversed or invalid transition chronology", () => {
  const result = buildProxCanonicalTransitionCase({
    ticker: "TEST",
    tradingDate: "2026-08-10",
    beforeCrowd: {
      observedAt: "2026-08-10T13:00:00.000Z",
      price: 10,
      role: "contender",
      rank: 2,
      score: 65,
    },
    spotMomentum: {
      observedAt: "2026-08-10T12:30:00.000Z",
      price: 11,
      role: "hero",
      rank: 1,
      score: 80,
    },
    outcome: { highestPrice: 12, lowestPrice: 10 },
  });

  assert.equal(result, null);
});
