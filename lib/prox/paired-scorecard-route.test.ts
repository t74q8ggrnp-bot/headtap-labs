import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../../app/api/prox-paired-scorecard/route.ts", import.meta.url),
  "utf8",
);
const doctrine = readFileSync(
  new URL("../../docs/PROX_GUIDE.md", import.meta.url),
  "utf8",
);

test("paired scorecard is internal, paginated, read-only, and provider-free", () => {
  assert.match(route, /isAuthorized\(request\)/);
  assert.match(route, /READ_PAGE_SIZE = 1_000/);
  assert.match(route, /source rows exceeded the bounded research window/);
  assert.match(route, /Historical research chunks cannot exceed seven days/);
  assert.match(route, /prox_shadow_board_member_outcomes/);
  assert.match(route, /edge_assessment/);
  assert.match(route, /researchChallenger/);
  assert.match(route, /PROX_EDGE_THEORY_CHALLENGER_VERSION/);
  assert.match(route, /outcomeComplete: outcome\.status === "complete"/);
  assert.match(route, /\.lt\("observed_at", windowEnd\)/);
  assert.match(route, /\.lt\("decision_at", windowEnd\)/);
  assert.match(route, /\.range\(offset, offset \+ READ_PAGE_SIZE - 1\)/);
  assert.match(route, /ht_agent_cohort_observations/);
  assert.match(route, /ht_agent_decision_frames/);
  assert.match(route, /ht_agent_visual_plan_versions/);
  assert.match(route, /ht_agent_visual_plans/);
  assert.match(route, /ht_agent_visual_plan_events/);
  assert.match(route, /agentTargetCalibration/);
  assert.match(route, /buildHtAgentCohortMetrics/);
  assert.match(route, /HT_AGENT_METRIC_DECISION_LIMIT \* 3/);
  assert.match(route, /boundedObservationWindow/);
  assert.match(route, /providerRequests: 0/);
  assert.doesNotMatch(route, /fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test("paired scorecard cannot automatically promote ProX authority", () => {
  assert.match(route, /buildProxCanonicalPairedScorecard/);
  assert.match(doctrine, /automatic|cannot change Canonical ranking/);
  assert.match(doctrine, /Missing, stale, misaligned, duplicate, or incomplete evidence is excluded/);
  assert.match(doctrine, /makes zero provider requests/);
});
