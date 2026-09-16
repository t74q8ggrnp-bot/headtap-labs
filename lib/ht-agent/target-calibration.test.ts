import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { summarizeAgentTargetCalibration } from "./target-calibration.ts";

test("target calibration counts only immutable lifecycle evidence", () => {
  const report = summarizeAgentTargetCalibration(
    [
      { id: "target-one", canonicalLane: "momentum", targetTwo: 12 },
      { id: "invalid", canonicalLane: "momentum", targetTwo: null },
      { id: "ambiguous", canonicalLane: "before_crowd", targetTwo: 22 },
      { id: "unresolved", canonicalLane: "before_crowd", targetTwo: null },
    ],
    [
      { planVersionId: "target-one", eventType: "entry_triggered", detail: {} },
      { planVersionId: "target-one", eventType: "target_reached", detail: { targetTwoReached: true } },
      { planVersionId: "invalid", eventType: "entry_triggered", detail: {} },
      { planVersionId: "invalid", eventType: "plan_invalidated", detail: {} },
      { planVersionId: "ambiguous", eventType: "price_order_ambiguous", detail: {} },
    ],
  );
  assert.equal(report.allPlans.planCount, 4);
  assert.equal(report.allPlans.triggeredPlanCount, 2);
  assert.equal(report.allPlans.targetOneReachedAfterTriggerRatePercent, 50);
  assert.equal(report.allPlans.targetTwoReachedAfterTriggerRatePercent, 100);
  assert.equal(report.allPlans.invalidatedPlanCount, 1);
  assert.equal(report.allPlans.ambiguousPlanCount, 1);
  assert.equal(report.allPlans.unresolvedPlanCount, 1);
  assert.equal(report.byCanonicalLane.length, 2);
  assert.equal(report.authority, "paper_only_research");
});

test("untriggered and unresolved plans are not silently counted as misses", () => {
  const report = summarizeAgentTargetCalibration(
    [{ id: "waiting", canonicalLane: "momentum", targetTwo: null }],
    [],
  );
  assert.equal(report.allPlans.targetOneReachedAfterTriggerRatePercent, null);
  assert.equal(report.allPlans.targetTwoReachedAfterTriggerRatePercent, null);
  assert.equal(report.allPlans.unresolvedPlanCount, 1);
});
