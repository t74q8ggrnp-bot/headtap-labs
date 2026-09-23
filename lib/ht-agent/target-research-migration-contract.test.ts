import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/0058_ht_agent_target_research_ledger.sql",
    import.meta.url,
  ),
  "utf8",
);
const observabilityMigration = readFileSync(
  new URL(
    "../../supabase/migrations/0059_research_observability_receipts.sql",
    import.meta.url,
  ),
  "utf8",
);
const repairMigration = readFileSync(
  new URL(
    "../../supabase/migrations/0061_target_research_persistence_and_health.sql",
    import.meta.url,
  ),
  "utf8",
);
const healthRoute = readFileSync(
  new URL("../../app/api/system-health/route.ts", import.meta.url),
  "utf8",
);
const outcomeWorker = readFileSync(
  new URL("../../app/api/ht-agent/outcomes/route.ts", import.meta.url),
  "utf8",
);

test("target-path research is additive, prospective, immutable, and research-only", () => {
  assert.match(migration, /create table if not exists public\.ht_agent_target_research_episodes/);
  assert.match(migration, /create table if not exists public\.ht_agent_target_research_results/);
  assert.match(migration, /after insert on public\.ht_agent_outcomes/);
  assert.match(migration, /ht_agent_target_research_episodes_immutable/);
  assert.match(migration, /ht_agent_target_research_results_immutable/);
  assert.match(migration, /authority text not null default 'research_only'/);
  assert.doesNotMatch(
    migration,
    /update public\.(?:ht_agent_decisions|ht_agent_decision_frames|ht_agent_profiles|prox_|canonical)/i,
  );
  assert.doesNotMatch(
    migration,
    /insert into public\.ht_agent_target_research_episodes[\s\S]{0,200}\bselect\b/i,
  );
});

test("episodes de-correlate repeated decisions and preserve frozen source evidence", () => {
  assert.match(
    migration,
    /unique\(profile_id,symbol,session_date,canonical_lane,horizon\)/,
  );
  assert.match(migration, /canonical_evidence jsonb not null/);
  assert.match(migration, /prox_evidence jsonb not null/);
  assert.match(migration, /market_facts jsonb not null/);
  assert.match(migration, /least_favorable_entry numeric not null/);
  assert.match(migration, /on conflict\(profile_id,symbol,session_date,canonical_lane,horizon\) do nothing/);
});

test("missing and ambiguous evidence cannot become target misses", () => {
  assert.match(migration, /resolution_state in \('measured','ambiguous','unavailable'\)/);
  assert.match(migration, /ambiguous_entry_candle/);
  assert.match(migration, /ambiguous_target_stop_candle/);
  assert.match(migration, /insufficient_provider_coverage/);
  assert.match(
    migration,
    /\(resolution_state='unavailable'\)=\(outcome_code='insufficient_provider_coverage'\)/,
  );
});

test("the existing outcome request is reused and every authority bit remains false", () => {
  assert.match(migration, /'targetEpisodes',target_claimed/);
  assert.match(migration, /e\.target_at<=n-interval '10 minutes'/);
  assert.match(migration, /row->>'symbol'=e\.symbol/);
  assert.match(migration, /'providerRequests',0/);
  assert.match(migration, /'providerRequestsAdded',0/);
  for (const field of [
    "canonicalDecision",
    "canonicalRanking",
    "agentDecision",
    "paperExecution",
    "liveExecution",
  ]) {
    assert.match(migration, new RegExp(`'${field}',false`));
  }
});

test("session results retain post-entry high/low and readiness cannot auto-promote", () => {
  assert.match(migration, /post_entry_maximum_high numeric/);
  assert.match(migration, /post_entry_minimum_low numeric/);
  assert.match(migration, /counts\.sessions>=30 and counts\.measured>=500/);
  assert.match(migration, /'canonicalEntryChallengerReady'/);
  assert.match(migration, /'executionAuthority','none'/);
  assert.doesNotMatch(migration, /alter table public\..*canonical.*score/i);
});

test("system health exposes collection progress without treating readiness as authority", () => {
  assert.match(healthRoute, /ht_agent_target_research_health/);
  assert.match(healthRoute, /ht_agent_target_path_research/);
  assert.match(healthRoute, /providerRequestsAdded/);
  assert.match(healthRoute, /executionAuthority/);
  assert.doesNotMatch(
    healthRoute.slice(healthRoute.indexOf("ht_agent_target_research_health")),
    /canonicalEntryChallengerReady\s*===\s*true/,
  );
});

test("research collection failures cannot block the existing outcome worker", () => {
  assert.match(migration, /exception when others then[\s\S]*target research seed skipped/);
  assert.match(outcomeWorker, /targetResearchFailures \+= 1/);
  assert.match(outcomeWorker, /targetResearchError \?\?=/);
  assert.doesNotMatch(
    outcomeWorker,
    /if \(targetResearchWrite\.error\) throw targetResearchWrite\.error/,
  );
});

test("prospective target research exposes deterministic expected-versus-persisted coverage", () => {
  assert.match(observabilityMigration, /ht_agent_target_research_observability/);
  assert.match(observabilityMigration, /coverage_started_at/);
  assert.match(observabilityMigration, /expected_episode_count/);
  assert.match(observabilityMigration, /persisted_episode_count/);
  assert.match(observabilityMigration, /missing_episode_count/);
  assert.match(observabilityMigration, /'coverageComplete',coverage\.missing_episode_count=0/);
  assert.match(observabilityMigration, /'seedFailureCount',failures\.total/);
});

test("target research seeds once per horizon from the full Agent cohort and records exceptions", () => {
  assert.match(observabilityMigration, /cohort_name is distinct from 'ht_agent_full'/);
  assert.match(observabilityMigration, /ht_agent_target_research_seed_failures/);
  assert.match(observabilityMigration, /on conflict\(outcome_id\) do nothing/);
  assert.match(observabilityMigration, /'triggerAttemptsPerEligibleDecision',3/);
  assert.match(observabilityMigration, /'providerRequestsAdded',0/);
  assert.doesNotMatch(
    observabilityMigration,
    /update public\.(?:ht_agent_decisions|ht_agent_decision_frames|ht_agent_profiles|prox_|canonical)/i,
  );
});

test("system health reports missing target-research receipts without making research primary health", () => {
  assert.match(healthRoute, /observabilityVersion/);
  assert.match(healthRoute, /coverageComplete === true/);
  assert.match(healthRoute, /missingEpisodeCount/);
  assert.match(healthRoute, /seedFailureCount/);
  assert.match(healthRoute, /blocking: false/);
  assert.match(healthRoute, /primaryProductImpact: false/);
  assert.match(healthRoute, /failureReceiptObservability/);
  assert.doesNotMatch(
    healthRoute.slice(healthRoute.indexOf("ht_agent_target_research_health")),
    /canonicalEntryChallengerReady\s*===\s*true/,
  );
});

test("0061 fixes the ambiguous session date without rewriting immutable history", () => {
  assert.match(observabilityMigration, /session_date date;/);
  assert.match(
    observabilityMigration,
    /on conflict\(profile_id,symbol,session_date,canonical_lane,horizon\) do nothing/,
  );
  assert.match(repairMigration, /episode_session_date date;/);
  assert.match(repairMigration, /on conflict do nothing/);
  assert.doesNotMatch(
    repairMigration,
    /on conflict\([^)]*session_date[^)]*\)/,
  );
  assert.match(repairMigration, /failure\.error_code='42702'/);
  assert.doesNotMatch(
    repairMigration,
    /(?:delete|update|truncate)\s+(?:table\s+)?public\.ht_agent_target_research_(?:seed_failures|episodes|results)/i,
  );
  assert.match(repairMigration, /provider_requests_added integer not null default 0/);
  assert.match(repairMigration, /check\(provider_requests_added=0\)/);
});

test("0061 bounded health separates historical failures from current coverage", () => {
  assert.match(repairMigration, /set statement_timeout='15s'/);
  assert.match(repairMigration, /with horizons\(horizon\)/);
  assert.match(repairMigration, /countsByHorizon/);
  assert.match(repairMigration, /'historicalSeedFailures'/);
  assert.match(repairMigration, /'coverageComplete',[\s\S]*totals\.missing=0[\s\S]*totals\.post_repair_failed=0/);
  assert.match(repairMigration, /'authority','research_only'/);
  assert.match(repairMigration, /'executionAuthority','none'/);
  assert.doesNotMatch(
    repairMigration,
    /update public\.(?:ht_agent_decisions|ht_agent_decision_frames|ht_agent_profiles|prox_|canonical)/i,
  );
  assert.match(healthRoute, /repairVersion === "ht-agent-target-research-repair-v1"/);
  assert.match(healthRoute, /postRepairSeedFailureCount\) === 0/);
  assert.doesNotMatch(
    healthRoute.slice(healthRoute.indexOf("const coverageReady")),
    /seedFailureCount\) === 0/,
  );
});
