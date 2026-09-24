import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/0064_agent_entry_target_challenger_scorecard.sql",
    import.meta.url,
  ),
  "utf8",
);
const outcomeWorker = readFileSync(
  new URL("../../app/api/ht-agent/outcomes/route.ts", import.meta.url),
  "utf8",
);
const healthRoute = readFileSync(
  new URL("../../app/api/system-health/route.ts", import.meta.url),
  "utf8",
);

test("entry-target challenger is a zero-authority derived scorecard", () => {
  assert.match(migration, /ht-agent-entry-target-challenger-v1/);
  assert.match(migration, /authority text not null default 'research_only'/);
  assert.match(migration, /provider_requests_added integer not null default 0 check\(provider_requests_added=0\)/);
  assert.match(migration, /forward_validation_required boolean not null default true/);
  assert.match(migration, /live_promotion_authorized boolean not null default false/);
  assert.doesNotMatch(
    migration,
    /(?:insert into|update|delete from) public\.(?:ht_agent_decisions|ht_agent_decision_frames|ht_agent_profiles|ht_opportunity|prox_|paper_)/i,
  );
});

test("scorecard measures entry margin, target margin and reward risk from frozen plans", () => {
  assert.match(migration, /target_one_percent/);
  assert.match(migration, /target_two_percent/);
  assert.match(migration, /risk_percent/);
  assert.match(migration, /rr_one/);
  assert.match(migration, /rr_two/);
  assert.match(migration, /entry_band_percent/);
  assert.match(migration, /where result\.resolution_state='measured'/);
  assert.match(migration, /maximum_favorable_excursion_percent/);
  assert.match(migration, /maximum_adverse_excursion_percent/);
});

test("probabilities keep the correct triggered and full-cohort denominators", () => {
  assert.match(migration, /entry_trigger_rate/);
  assert.match(migration, /target_one_after_trigger_rate/);
  assert.match(migration, /target_two_after_trigger_rate/);
  assert.match(migration, /stop_before_target_after_trigger_rate/);
  assert.match(
    migration,
    /count\(\*\) filter\(where entry_triggered_at is not null\)::numeric\/count\(\*\)/,
  );
  assert.match(
    migration,
    /nullif\(count\(\*\) filter\(where entry_triggered_at is not null\),0\)/,
  );
});

test("sample readiness cannot promote the challenger automatically", () => {
  assert.match(migration, /source_sessions>=30 and measured_results>=500/);
  assert.match(migration, /sample_size>=100 and session_count>=30/);
  assert.match(migration, /'forwardValidationRequired',true/);
  assert.match(migration, /'livePromotionAuthorized',false/);
  assert.match(migration, /'canonicalScoringChanged',false/);
  assert.match(migration, /'agentRiskChanged',false/);
  assert.match(migration, /'paperBehaviorChanged',false/);
});

test("outcome worker refreshes only after new target outcomes without provider fan-out", () => {
  assert.match(outcomeWorker, /if \(targetResearchInserted > 0\)/);
  assert.match(outcomeWorker, /ht_agent_refresh_entry_target_challenger/);
  assert.match(outcomeWorker, /entryTargetChallengerProviderRequests: 0/);
  assert.doesNotMatch(
    outcomeWorker,
    /if \(challengerRefresh\.error\) throw challengerRefresh\.error/,
  );
});

test("system health reports progress separately from primary-product health", () => {
  assert.match(healthRoute, /ht_agent_entry_target_challenger_health/);
  assert.match(healthRoute, /name: "ht_agent_entry_target_challenger"/);
  assert.match(healthRoute, /blocking: false/);
  assert.match(healthRoute, /forwardValidationRequired === true/);
  assert.match(healthRoute, /livePromotionAuthorized === false/);
  assert.match(healthRoute, /Live Canonical scoring remains unchanged/);
});
