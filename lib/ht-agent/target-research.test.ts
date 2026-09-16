import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { evaluateHtAgentTargetResearch, extendExistingOutcomeRangesForTargetResearch } from "./target-research.ts";

const start = Date.parse("2026-09-16T14:00:00.000Z");
const episode = {
  id: "00000000-0000-4000-8000-000000000001",
  decisionId: "00000000-0000-4000-8000-000000000002",
  symbol: "TEST",
  horizon: "15m" as const,
  validFrom: new Date(start).toISOString(),
  targetAt: new Date(start + 15 * 60_000).toISOString(),
  leastFavorableEntry: 10,
  triggerPrice: 9.9,
  stopPrice: 9,
  targetOne: 11,
  targetTwo: 12,
};

function bar(index: number, low = 9.8, high = 10.2, close = 10.1) {
  return {
    timeMs: start + index * 60_000,
    open: 10,
    high,
    low,
    close,
    volume: 1_000,
  };
}

function fullBars(overrides: Record<number, ReturnType<typeof bar>> = {}) {
  return Array.from({ length: 15 }, (_, index) => overrides[index] ?? bar(index));
}

test("measures Target 1 and Target 2 before the stop", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars({
    2: bar(2, 9.7, 11.2, 11),
    4: bar(4, 9.8, 12.2, 12),
  }));
  assert.equal(result.resolutionState, "measured");
  assert.equal(result.outcomeCode, "target_two_before_stop");
  assert.equal(result.targetOneReachedAt, "2026-09-16T14:03:00.000Z");
  assert.equal(result.targetTwoReachedAt, "2026-09-16T14:05:00.000Z");
  assert.equal(result.stopReachedAt, null);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.postEntryMaximumHigh, 12.2);
  assert.equal(result.postEntryMinimumLow, 9.7);
});

test("keeps a stop before Target 1 as a measured loss path", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars({
    2: bar(2, 8.9, 10.3, 9.1),
  }));
  assert.equal(result.resolutionState, "measured");
  assert.equal(result.outcomeCode, "stop_before_target");
  assert.equal(result.targetOneReachedAt, null);
  assert.equal(result.stopReachedAt, "2026-09-16T14:03:00.000Z");
});

test("does not invent ordering when one minute crosses a target and stop", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars({
    2: bar(2, 8.8, 11.2, 10),
  }));
  assert.equal(result.resolutionState, "ambiguous");
  assert.equal(result.outcomeCode, "ambiguous_target_stop_candle");
});

test("does not invent ordering on the entry-trigger candle", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars({
    0: bar(0, 9.8, 11.2, 10.5),
  }));
  assert.equal(result.resolutionState, "ambiguous");
  assert.equal(result.outcomeCode, "ambiguous_entry_candle");
  assert.equal(result.postEntryMaximumHigh, null);
});

test("retains sparse successful provider tape with explicit coverage", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars().slice(0, 8));
  assert.equal(result.resolutionState, "measured");
  assert.equal(result.outcomeCode, "expired_after_entry");
  assert.equal(result.expectedIntervalCount, 15);
  assert.equal(result.providerBarCount, 8);
  assert.equal(result.coveragePercent, 53.33);
});

test("continues after Target 1 so Target 2 can be measured independently", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars({
    2: bar(2, 9.7, 11.2, 11),
  }));
  assert.equal(result.outcomeCode, "target_one_before_stop");
  assert.notEqual(result.targetOneReachedAt, null);
  assert.equal(result.targetTwoReachedAt, null);
  assert.equal(result.stopReachedAt, null);
});

test("records an untriggered expiry separately from a target miss", () => {
  const result = evaluateHtAgentTargetResearch({
    ...episode,
    leastFavorableEntry: 10.5,
    triggerPrice: 10.4,
    targetOne: 11.5,
    targetTwo: 12.5,
  }, fullBars());
  assert.equal(result.resolutionState, "measured");
  assert.equal(result.outcomeCode, "expired_untriggered");
  assert.equal(result.entryTriggeredAt, null);
});

test("carries an explicit all-false authority receipt", () => {
  const result = evaluateHtAgentTargetResearch(episode, fullBars());
  assert.deepEqual(result.authority, {
    canonicalDecision: false,
    canonicalRanking: false,
    agentDecision: false,
    paperExecution: false,
    liveExecution: false,
  });
});

test("reuses an existing symbol request and never creates a provider request", () => {
  const existing = new Map([["TEST", {
    fromMs: start + 14 * 60_000,
    toMs: start + 16 * 60_000,
  }]]);
  const extraSymbol = { ...episode, id: "extra", symbol: "EXTRA" };
  const plan = extendExistingOutcomeRangesForTargetResearch(
    existing,
    [episode, extraSymbol],
  );
  assert.equal(plan.providerRequestsAdded, 0);
  assert.equal(plan.ranges.size, 1);
  assert.equal(plan.ranges.get("TEST")?.fromMs, start);
  assert.equal(plan.ranges.get("TEST")?.toMs, start + 16 * 60_000);
  assert.deepEqual(plan.eligibleEpisodes.map((row) => row.symbol), ["TEST"]);
});
