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
  assert.match(route, /\.range\(offset, offset \+ READ_PAGE_SIZE - 1\)/);
  assert.match(route, /ht_agent_cohort_observations/);
  assert.match(route, /ht_agent_decision_frames/);
  assert.match(route, /buildHtAgentCohortMetrics/);
  assert.match(route, /providerRequests: 0/);
  assert.doesNotMatch(route, /fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test("paired scorecard cannot automatically promote ProX authority", () => {
  assert.match(route, /buildProxCanonicalPairedScorecard/);
  assert.match(doctrine, /automatic|cannot change Canonical ranking/);
  assert.match(doctrine, /Missing, stale, misaligned, duplicate, or incomplete evidence is excluded/);
  assert.match(doctrine, /makes zero provider requests/);
});
