import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { assertNoForbiddenProxInputs, scoreProxEdge } from "./edge-score.ts";

const structure = {
  version: "prox-market-structure-v1" as const,
  atr14: 0.5,
  atrPercent: 5,
  realizedIntradayRangePercent: 8,
  dailySupport: 9.2,
  intradaySwingLow: 9.5,
  vwapSupport: 9.6,
  structuralSupport: 9.5,
  invalidationPrice: 9.4,
  structuralRiskPercent: 6,
  resistancePrice: 12,
  priceDiscovery: false,
  continuationCapacityPercent: 20,
  scenarioRiskReward: 3.333,
  dailyTrendPercent: 12,
  extensionAtrMultiple: 0.8,
  extended: false,
  postPeakFailure: false,
  measurable: true,
  reasons: ["Observed structure is measurable."],
};

const input = {
  ticker: "TEST",
  price: 10,
  snapshotPrice: 10,
  sourceObservedAt: "2026-08-14T14:00:00.000Z",
  decisionAt: "2026-08-14T14:01:00.000Z",
  securityType: "CS" as const,
  previousCloseChangePercent: 18,
  sessionChangePercent: 6,
  timeAdjustedRelativeVolume: 4,
  dollarVolume: 5_000_000,
  velocity1m: 1.2,
  acceleration5m: 4,
  volumeAcceleration: 3,
  priceVsVwap: 4,
  pulsePrice: 10.02,
  pulseAgeMinutes: 1,
  observationAgeMinutes: 1,
  pullbackFromWindowHighPercent: 1,
  corporateActionSuspected: false,
  anomalyFlags: ["price_expansion", "volume_breakout"],
  dailyBarCount: 60,
  intradayBarCount: 30,
  structure,
  event: null,
  calibration: null,
};

test("scores only independent evidence and qualifies honest positive asymmetry", () => {
  const result = scoreProxEdge(input);
  assert.equal(result.entryQualified, true);
  assert.ok(result.edgeScore > 60);
  assert.equal(result.components.comparableOutcomes, null);
  assert.match(result.reasons.join(" "), /insufficient/);
});

test("blocks a sub-1.0 independent scenario without hiding the mover", () => {
  const result = scoreProxEdge({
    ...input,
    structure: { ...structure, scenarioRiskReward: 0.8 },
  });
  assert.equal(result.entryQualified, false);
  assert.match(result.hardFailures.join(" "), /below 1.0/);
  assert.ok(result.edgeScore > 0);
});

test("forbidden canonical fields fail before scoring", () => {
  assert.throws(
    () => assertNoForbiddenProxInputs({ market: input, canonicalScore: 95 }),
    /Forbidden canonical input/,
  );
  assert.throws(
    () => scoreProxEdge({ ...input, ht_score: 100 } as never),
    /Forbidden canonical input/,
  );
  assert.throws(
    () => assertNoForbiddenProxInputs({ facts: input, rank: 1 }),
    /Forbidden canonical input/,
  );
});

test("two-clock evidence rewards active participation over a fading prior move", () => {
  const active = scoreProxEdge(input);
  const fading = scoreProxEdge({
    ...input,
    previousCloseChangePercent: 80,
    sessionChangePercent: -8,
  });
  assert.ok(
    active.components.twoClockAlignment > fading.components.twoClockAlignment,
  );
  assert.ok(active.continuationProbability > fading.continuationProbability);
});

test("price consistency tolerance expands with observed volatility but stays bounded", () => {
  const volatile = scoreProxEdge({
    ...input,
    pulsePrice: 11,
    structure: { ...structure, atrPercent: 20 },
  });
  assert.doesNotMatch(volatile.hardFailures.join(" "), /internally inconsistent/);

  const impossible = scoreProxEdge({
    ...input,
    pulsePrice: 14,
    structure: { ...structure, atrPercent: 50 },
  });
  assert.match(impossible.hardFailures.join(" "), /internally inconsistent/);
});

test("does not manufacture a hero qualification from a weak but measurable setup", () => {
  const result = scoreProxEdge({
    ...input,
    previousCloseChangePercent: -12,
    sessionChangePercent: -6,
    velocity1m: -3,
    acceleration5m: -5,
    timeAdjustedRelativeVolume: 0.3,
    volumeAcceleration: 0.2,
    priceVsVwap: -5,
    pullbackFromWindowHighPercent: 7,
    structure: {
      ...structure,
      dailyTrendPercent: -8,
      continuationCapacityPercent: 6,
      scenarioRiskReward: 1,
    },
  });
  assert.equal(result.entryQualified, false);
  assert.match(result.hardFailures.join(" "), /entry-quality floor/);
});

test("fails closed when independent timestamps are invalid or reversed", () => {
  const result = scoreProxEdge({
    ...input,
    sourceObservedAt: "2026-08-14T14:02:00.000Z",
    decisionAt: "2026-08-14T14:01:00.000Z",
  });
  assert.equal(result.entryQualified, false);
  assert.match(result.hardFailures.join(" "), /timestamps are invalid/);
});
