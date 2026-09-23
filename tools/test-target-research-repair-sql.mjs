// Isolated PostgreSQL only: no credentials, production writes, or provider calls.
// Usage: node tools/test-target-research-repair-sql.mjs /absolute/path/to/pglite/dist/index.js
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

if (!isAbsolute(process.argv[2] ?? "")) throw new Error("Supply isolated PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;

async function seedEligibleDecision(symbol) {
  const user = randomUUID();
  const account = randomUUID();
  const profile = randomUUID();
  const run = randomUUID();
  const frame = randomUUID();
  const decision = randomUUID();
  const cohort = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("insert into public.paper_accounts(id,user_id) values($1,$2)", [account, user]);
  await db.query(
    "insert into public.ht_agent_profiles(id,user_id,paper_account_id,mode) values($1,$2,$3,'observe')",
    [profile, user, account],
  );
  await db.query(
    "insert into public.ht_agent_runs(id,profile_id,user_id,mode,started_at) values($1,$2,$3,'observe',now()-interval '3 hours')",
    [run, profile, user],
  );
  await db.query(`insert into public.ht_agent_decision_frames(
    id,profile_id,user_id,run_id,frame_version,frame_hash,symbol,captured_at,
    provider_timestamp,canonical_decision_timestamp,market_facts,canonical_evidence,
    prox_evidence,catalyst_evidence,paper_account_state
  ) values($1,$2,$3,$4,'frame-v1',$5,$6,now()-interval '3 hours',
    now()-interval '3 hours',now()-interval '3 hours','{}',
    '{"sourceLane":"momentum"}','{}','{}','{}')`,
  [frame, profile, user, run, randomUUID().replaceAll("-", ""), symbol]);
  await db.query(`insert into public.ht_agent_decisions(
    id,profile_id,user_id,run_id,frame_id,symbol,decision_version,policy_version,mode,
    action,proposed_entry,proposed_stop,proposed_target,risk_allowed,risk_rules,
    explanation,trade_plan
  ) values($1,$2,$3,$4,$5,$6,'decision-v1','risk-v1','observe','prepare',
    10,9,12,true,'{}','fixture',
    '{"status":"paper_entry_eligible","entryZone":{"high":10},"confirmationTrigger":10,"invalidation":9,"targetOne":12,"targetTwo":13}')`,
  [decision, profile, user, run, frame, symbol]);
  await db.query(`insert into public.ht_agent_cohort_observations(
    id,decision_id,frame_id,profile_id,user_id,cohort,would_enter,reason,
    decision_price,observed_at
  ) values($1,$2,$3,$4,$5,'ht_agent_full',true,'fixture',10,now()-interval '3 hours')`,
  [cohort, decision, frame, profile, user]);
  for (const [horizon, minutes] of [["15m", 15], ["60m", 60], ["session", 120]]) {
    await db.query(`insert into public.ht_agent_outcomes(
      decision_id,cohort_observation_id,profile_id,user_id,horizon,target_at
    ) values($1,$2,$3,$4,$5,now()-interval '3 hours'+($6::text||' minutes')::interval)`,
    [decision, cohort, profile, user, horizon, minutes]);
  }
  return { decision };
}

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
`);
for (const name of [
  "0011_crypto_prox_observation_history.sql",
  "0012_crypto_multivenue_discovery.sql",
  "0024_manual_paper_trading.sql",
  "0030_ht_agent_phase1.sql",
  "0031_ht_trade_plan.sql",
  "0035_coinapi_vercel_pilot.sql",
  "0036_crypto_research_evidence_integrity.sql",
  "0037_crypto_legacy_observation_only.sql",
  "0038_crypto_audit_and_health.sql",
  "0039_crypto_audit_query_repair.sql",
  "0040_manual_crypto_paper.sql",
  "0041_coinapi_bounded_timeout_recovery.sql",
  "0045_operational_lifecycle_recovery.sql",
  "0046_ht_agent_outcome_worker.sql",
  "0058_ht_agent_target_research_ledger.sql",
  "0059_research_observability_receipts.sql",
]) await db.exec(await read(name));

await seedEligibleDecision("TESTA");
assert.equal(Number(await value("select count(*) as value from public.ht_agent_target_research_episodes")), 0);
assert.equal(Number(await value("select count(*) as value from public.ht_agent_target_research_seed_failures where error_code='42702'")), 3);

await db.exec(await read("0061_target_research_persistence_and_health.sql"));
assert.equal(Number(await value("select count(*) as value from public.ht_agent_target_research_episodes")), 3);
assert.equal(Number(await value("select count(*) as value from public.ht_agent_target_research_seed_failures where error_code='42702'")), 3);

const repaired = await value("select public.ht_agent_target_research_health() as value");
assert.equal(repaired.coverageComplete, true);
assert.equal(Number(repaired.missingEpisodeCount), 0);
assert.equal(Number(repaired.postRepairSeedFailureCount), 0);
for (const horizon of ["15m", "60m", "session"]) {
  assert.equal(Number(repaired.countsByHorizon[horizon].expected), 1);
  assert.equal(Number(repaired.countsByHorizon[horizon].persisted), 1);
  assert.equal(Number(repaired.countsByHorizon[horizon].historicalSeedFailures), 1);
  assert.equal(Number(repaired.countsByHorizon[horizon].pending), 1);
  assert.equal(Number(repaired.countsByHorizon[horizon].unavailable), 0);
}

await seedEligibleDecision("TESTB");
assert.equal(Number(await value("select count(*) as value from public.ht_agent_target_research_episodes")), 6);
assert.equal(Number(await value("select count(*) as value from public.ht_agent_target_research_seed_failures")), 3);

const episodesBeforeRerun = await value(
  "select jsonb_agg(to_jsonb(episode) order by episode.id) as value from public.ht_agent_target_research_episodes as episode",
);
await db.exec(await read("0061_target_research_persistence_and_health.sql"));
assert.deepEqual(
  await value("select jsonb_agg(to_jsonb(episode) order by episode.id) as value from public.ht_agent_target_research_episodes as episode"),
  episodesBeforeRerun,
);

const started = performance.now();
const plan = await db.query(
  "explain (analyze, format json) select public.ht_agent_target_research_health()",
);
const elapsedMs = performance.now() - started;
assert.ok(elapsedMs < 15_000, `health query exceeded 15 seconds: ${elapsedMs.toFixed(1)}ms`);
assert.ok(plan.rows.length > 0);

const receipt = await value(
  "select to_jsonb(receipt) as value from public.ht_agent_target_research_repair_receipts as receipt",
);
assert.equal(Number(receipt.failure_receipts_preserved), 3);
assert.equal(Number(receipt.missing_deduplicated_episodes_before), 3);
assert.equal(Number(receipt.backfilled_episode_count), 3);
assert.equal(Number(receipt.missing_deduplicated_episodes_after), 0);
assert.equal(Number(receipt.provider_requests_added), 0);

console.log(JSON.stringify({
  reproducedSqlState: "42702",
  immutableFailuresPreserved: 3,
  backfilledEpisodes: 3,
  collectorEpisodesAfterRepair: 3,
  rerunDuplicateEpisodes: 0,
  healthElapsedMs: Number(elapsedMs.toFixed(1)),
  healthPlan: plan.rows[0],
  countsByHorizon: repaired.countsByHorizon,
}, null, 2));
await db.close();
