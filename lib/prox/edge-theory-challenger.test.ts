import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { buildProxEdgeTheoryChallenger } from "./edge-theory-challenger.ts";

const baseInput = {
  components: {
    liveImpulse: 72,
    participation: 68,
    vwapPosition: 64,
    peakRetention: 70,
    marketStructure: 66,
    twoClockAlignment: 62,
    comparableOutcomes: null,
    newsAttention: null,
  },
  rewardRiskAsymmetry: 72,
  evidenceConfidence: 80,
  currentRiskPenalty: 0,
  currentExtended: false,
  extensionAtrMultiple: 1,
  calibration: null,
  newsSourceCount: 0,
  readiness: "live_only" as const,
  hardFailures: [],
};

test("keeps evidence confidence out of the bullish score", () => {
  const highConfidence = buildProxEdgeTheoryChallenger(baseInput);
  const lowerConfidence = buildProxEdgeTheoryChallenger({
    ...baseInput,
    evidenceConfidence: 56,
  });
  assert.equal(highConfidence.score, lowerConfidence.score);
  assert.equal(
    highConfidence.continuationEstimate,
    lowerConfidence.continuationEstimate,
  );
});

test("keeps missing optional evidence neutral without renormalizing other weights", () => {
  const result = buildProxEdgeTheoryChallenger(baseInput);
  assert.equal(result.components.comparableOutcomes, 50);
  assert.equal(result.components.newsAttention, 50);
  assert.equal(result.components.calibrationReliability, 0);
  assert.equal(result.components.newsReliability, 0);
});

test("shrinks an emerging outcome rate toward the neutral prior", () => {
  const result = buildProxEdgeTheoryChallenger({
    ...baseInput,
    components: { ...baseInput.components, comparableOutcomes: 100 },
    calibration: {
      sampleSize: 30,
      continuationRate: 1,
      evidenceState: "emerging" as const,
    },
    readiness: "emerging" as const,
  });
  assert.equal(result.components.calibrationReliability, 23.1);
  assert.equal(result.components.comparableOutcomes, 61.5);
  assert.match(result.reasons.join(" "), /low-reliability/);
});

test("replaces the fixed extension deduction with a continuous exhaustion penalty", () => {
  const mild = buildProxEdgeTheoryChallenger({
    ...baseInput,
    extensionAtrMultiple: 1.6,
  });
  const severe = buildProxEdgeTheoryChallenger({
    ...baseInput,
    components: { ...baseInput.components, liveImpulse: 100 },
    currentRiskPenalty: 8,
    currentExtended: true,
    extensionAtrMultiple: 4,
  });
  assert.equal(mild.components.extensionExhaustionPenalty, 0.4);
  assert.ok(
    severe.components.extensionExhaustionPenalty >
      mild.components.extensionExhaustionPenalty,
  );
  assert.ok(severe.score < mild.score);
});

test("has no public, Agent, Paper, or live-execution authority", () => {
  const result = buildProxEdgeTheoryChallenger(baseInput);
  assert.deepEqual(result.authority, {
    canonicalDecision: false,
    canonicalRanking: false,
    publicDisplay: false,
    agentDecision: false,
    paperExecution: false,
    liveExecution: false,
  });
});
