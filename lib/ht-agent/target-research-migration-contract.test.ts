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
