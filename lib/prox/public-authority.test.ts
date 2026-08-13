import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { PROX_PUBLIC_AUTHORITY_CONTRACT, evaluateProxPublicAuthority } from "./public-authority.ts";

const pulse = {
  fresh: true,
  state: "expanding" as const,
  peakFailureConfirmed: false,
  peakFailureThresholdPercent: 6,
  pullbackFromWindowHighPercent: 0,
  velocity1m: 1,
  acceleration5m: 2,
  volumeAcceleration: 1.5,
  priceVsVwap: 2,
};

test("healthy live tape has bounded support authority", () => {
  const decision = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 100,
    sessionPeakPullbackPercent: 1,
    pulse,
  });
  assert.equal(
    decision.rankAdjustment,
    PROX_PUBLIC_AUTHORITY_CONTRACT.maximumSupportAdjustment,
  );
  assert.equal(decision.supportsContinuation, true);
  assert.equal(decision.peakFailureConfirmed, false);
});

test("ordinary weak tape is bounded and does not become a hard failure", () => {
  const decision = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 20,
    sessionPeakPullbackPercent: 5,
    pulse: { ...pulse, state: "weakening" },
  });
  assert.equal(
    decision.rankAdjustment,
    PROX_PUBLIC_AUTHORITY_CONTRACT.maximumOrdinaryPenalty,
  );
  assert.equal(decision.supportsContinuation, false);
  assert.equal(decision.peakFailureConfirmed, false);
});

test("confirmed post-peak deterioration blocks eligibility", () => {
  const decision = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 80,
    sessionPeakPullbackPercent: 12,
    pulse: {
      ...pulse,
      velocity1m: -1,
      acceleration5m: -2,
      priceVsVwap: -1,
      pullbackFromWindowHighPercent: 8,
    },
  });
  assert.equal(decision.peakFailureConfirmed, true);
  assert.equal(decision.supportsContinuation, false);
  assert.equal(decision.rankAdjustment, -27);
});

test("stale or missing pulse cannot manufacture support", () => {
  const stale = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 100,
    sessionPeakPullbackPercent: 0,
    pulse: { ...pulse, fresh: false, state: "stale" },
  });
  assert.equal(stale.marketConfirmation, null);
  assert.equal(stale.supportsContinuation, false);
  assert.equal(stale.rankAdjustment, -8);
});
