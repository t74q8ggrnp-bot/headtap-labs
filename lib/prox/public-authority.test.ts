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
  averageBarRangePercent: 2,
};

test("healthy live tape has bounded support authority", () => {
  const decision = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 100,
    sessionPeakPullbackPercent: 1,
    activeSessionChangePercent: 20,
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
    activeSessionChangePercent: 10,
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
    activeSessionChangePercent: -2,
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
    activeSessionChangePercent: 10,
    pulse: { ...pulse, fresh: false, state: "stale" },
  });
  assert.equal(stale.marketConfirmation, null);
  assert.equal(stale.supportsContinuation, false);
  assert.equal(stale.rankAdjustment, -8);
});

test("a local bounce cannot erase severe full-session structure damage", () => {
  const decision = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 100,
    sessionPeakPullbackPercent: 44.8,
    activeSessionChangePercent: -31.2,
    pulse: {
      ...pulse,
      velocity1m: 0.6,
      acceleration5m: 7.6,
      volumeAcceleration: 2.6,
      priceVsVwap: 3.4,
      pullbackFromWindowHighPercent: 2.8,
    },
  });
  assert.equal(decision.peakFailureConfirmed, false);
  assert.equal(decision.deepSessionRecoveryWithheld, true);
  assert.equal(decision.supportsContinuation, false);
  assert.equal(
    decision.rankAdjustment,
    PROX_PUBLIC_AUTHORITY_CONTRACT.maximumOrdinaryPenalty,
  );
});

test("a strong runner slightly below its open is not treated as burnt out", () => {
  const decision = evaluateProxPublicAuthority({
    activeMarketSession: true,
    marketConfirmation: 74,
    sessionPeakPullbackPercent: 30,
    activeSessionChangePercent: -3,
    pulse: { ...pulse, pullbackFromWindowHighPercent: 3 },
  });
  assert.equal(decision.deepSessionRecoveryWithheld, false);
  assert.equal(decision.supportsContinuation, true);
});
