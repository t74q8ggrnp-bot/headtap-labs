import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_AGENT_COHORT_VERSION } from "./contracts.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildHtAgentCohortMetrics, htAgentMetricWindowEnd } from "./cohort-metrics.ts";

function observations(decisionId: string, version = HT_AGENT_COHORT_VERSION as string) {
  return ["canonical_only", "canonical_prox", "ht_agent_full"].map((cohort) => ({
    id: `${decisionId}-${cohort}`, decision_id: decisionId, cohort,
    cohort_version: version, would_enter: true,
  }));
}

test("the metric window allows the shared horizon to mature even when cycles are frequent", () => {
  assert.equal(htAgentMetricWindowEnd(new Date("2026-09-02T19:30:00Z")), "2026-09-02T19:15:00.000Z");
});

test("cohort metrics isolate version, horizon, matched decisions and missing outcomes", () => {
  const rows = [
    ...observations("current"), ...observations("pending"),
    ...observations("legacy", "ht-agent-cohorts-v1"), observations("partial")[0],
    ...observations("before-clock-fix", "ht-agent-cohorts-v2-mode-independent"),
  ];
  const outcomes = rows.flatMap((row) => [
    { cohort_observation_id: row.id, horizon: "15m", complete: true, return_percent: row.decision_id === "pending" ? null : "2" },
    { cohort_observation_id: row.id, horizon: "30s", complete: true, return_percent: 900 },
    { cohort_observation_id: row.id, horizon: "60m", complete: true, return_percent: -900 },
  ]);
  for (const metric of buildHtAgentCohortMetrics(rows, outcomes)) {
    assert.equal(metric.cohortVersion, HT_AGENT_COHORT_VERSION);
    assert.equal(metric.horizon, "15m");
    assert.equal(metric.observations, 2);
    assert.equal(metric.wouldEnter, 2);
    assert.equal(metric.measuredOutcomes, 1);
    assert.equal(metric.unmeasuredQualified, 1);
    assert.equal(metric.averageReturnPercent, 2);
    assert.equal(metric.positiveRatePercent, 100);
  }
});

test("no outcomes means unknown performance, not a zero or losing trade", () => {
  for (const metric of buildHtAgentCohortMetrics(observations("new"), [])) {
    assert.equal(metric.measuredOutcomes, 0);
    assert.equal(metric.averageReturnPercent, null);
    assert.equal(metric.positiveRatePercent, null);
  }
});

test("nonqualified cases do not inflate qualified outcome counts and zero returns are measured", () => {
  const rows = observations("current").map((row) => ({ ...row, would_enter: row.cohort === "ht_agent_full" }));
  const outcomes = rows.map((row) => ({ cohort_observation_id: row.id, horizon: "15m", complete: true, return_percent: 0 }));
  const metrics = buildHtAgentCohortMetrics(rows, outcomes);
  assert.equal(metrics[0].measuredOutcomes, 0);
  assert.equal(metrics[0].wouldEnter, 0);
  assert.equal(metrics[2].measuredOutcomes, 1);
  assert.equal(metrics[2].averageReturnPercent, 0);
  assert.equal(metrics[2].positiveRatePercent, 0);
  assert.equal(buildHtAgentCohortMetrics(rows, [...outcomes, ...outcomes])[2].measuredOutcomes, 1);
});
