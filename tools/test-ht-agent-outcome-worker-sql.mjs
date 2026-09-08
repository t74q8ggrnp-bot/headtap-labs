// Isolated PostgreSQL only: no credentials, production writes or provider calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!isAbsolute(process.argv[2] ?? "")) throw new Error("Supply isolated PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;

test.before(async () => {
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
    "0035_coinapi_vercel_pilot.sql",
    "0036_crypto_research_evidence_integrity.sql",
    "0037_crypto_legacy_observation_only.sql",
    "0038_crypto_audit_and_health.sql",
    "0039_crypto_audit_query_repair.sql",
    "0040_manual_crypto_paper.sql",
    "0041_coinapi_bounded_timeout_recovery.sql",
    "0045_operational_lifecycle_recovery.sql",
    "0046_ht_agent_outcome_worker.sql",
  ]) await db.exec(await read(name));
});
test.after(() => db.close());

async function seedDueCohorts() {
  const user = randomUUID(), account = randomUUID(), profile = randomUUID();
  const run = randomUUID(), frame = randomUUID(), decision = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("insert into public.paper_accounts(id,user_id) values($1,$2)", [account, user]);
  await db.query("insert into public.ht_agent_profiles(id,user_id,paper_account_id,mode) values($1,$2,$3,'observe')", [profile, user, account]);
  await db.query("insert into public.ht_agent_runs(id,profile_id,user_id,mode,started_at) values($1,$2,$3,'observe',now()-interval '20 minutes')", [run, profile, user]);
  await db.query(`insert into public.ht_agent_decision_frames(
    id,profile_id,user_id,run_id,frame_version,frame_hash,symbol,captured_at,
    provider_timestamp,canonical_decision_timestamp,market_facts,canonical_evidence,
    prox_evidence,catalyst_evidence,paper_account_state
  ) values($1,$2,$3,$4,'frame-v1',$5,'CHPT',now()-interval '20 minutes',
    now()-interval '20 minutes',now()-interval '20 minutes','{}','{}','{}','{}','{}')`,
  [frame, profile, user, run, randomUUID().replaceAll("-", "")]);
  await db.query(`insert into public.ht_agent_decisions(
    id,profile_id,user_id,run_id,frame_id,symbol,decision_version,policy_version,mode,
    action,proposed_entry,risk_allowed,risk_rules,explanation
  ) values($1,$2,$3,$4,$5,'CHPT','decision-v1','risk-v1','observe','observe',7.5,false,'{}','fixture')`,
  [decision, profile, user, run, frame]);
  const cohorts = [];
  for (const cohort of ["canonical_only", "canonical_prox", "ht_agent_full"]) {
    const id = randomUUID(); cohorts.push(id);
    await db.query(`insert into public.ht_agent_cohort_observations(
      id,decision_id,frame_id,profile_id,user_id,cohort,would_enter,reason,decision_price,observed_at
    ) values($1,$2,$3,$4,$5,$6,true,'fixture',7.5,now()-interval '20 minutes')`,
    [id, decision, frame, profile, user, cohort]);
    await db.query(`insert into public.ht_agent_outcomes(
      decision_id,cohort_observation_id,profile_id,user_id,horizon,target_at
    ) values($1,$2,$3,$4,'5m',now()-interval '15 minutes')`, [decision, id, profile, user]);
  }
  return { profile, run, cohorts };
}

test("one lease claims cohort rows and one batch atomically completes them", async () => {
  const seeded = await seedDueCohorts();
  const worker = randomUUID();
  const claim = await value("select public.ht_agent_claim_outcome_batch($1,900) as value", [worker]);
  assert.equal(claim.allowed, true);
  assert.equal(claim.claimed, 3);
  assert.equal(claim.retiredAgentRuns, 1);
  assert.equal(new Set(claim.rows.map((row) => row.symbol)).size, 1);
  const competing = await value("select public.ht_agent_claim_outcome_batch($1,900) as value", [randomUUID()]);
  assert.equal(competing.allowed, false);
  assert.equal(competing.reason, "worker_in_progress");
  const observedAt = new Date().toISOString();
  const providerTimestamp = new Date(Date.now() - 14 * 60_000).toISOString();
  const updates = claim.rows.map((row) => ({
    id: row.id, observed_at: observedAt, provider_timestamp: providerTimestamp,
    quote_provider_timestamp: providerTimestamp, bid: 7.59, ask: 7.61,
    spread_percent: 0.263157, price: 7.6, return_percent: 1.083333,
    resolution_state: "measured", unavailable_reason: null,
  }));
  const finish = await value("select public.ht_agent_finish_outcome_batch($1,$2::jsonb,$3::jsonb) as value", [
    worker, JSON.stringify(updates), JSON.stringify({ measured: 3 }),
  ]);
  assert.equal(finish.ok, true);
  assert.equal(finish.completed, 3);
  assert.equal(Number(await value("select count(*) as value from public.ht_agent_outcomes where complete")), 3);
  assert.equal(await value("select status as value from public.ht_agent_runs where id=$1", [seeded.run]), "failed");
  const health = await value("select public.ht_agent_lifecycle_health() as value");
  assert.equal(health.version, "ht-agent-run-lifecycle-v2");
  assert.equal(health.outcomeWorkerInstalled, true);
  assert.equal(health.overdueRunningCycles, 0);
});

test("migration rerun preserves completed outcomes and worker history", async () => {
  const before = await value("select jsonb_agg(to_jsonb(o) order by o.id) as value from public.ht_agent_outcomes o");
  await db.exec(await read("0046_ht_agent_outcome_worker.sql"));
  assert.deepEqual(await value("select jsonb_agg(to_jsonb(o) order by o.id) as value from public.ht_agent_outcomes o"), before);
});

test("ProX outcome lease blocks overlap and releases without touching evidence", async () => {
  const worker = randomUUID();
  const before = await value("select count(*) as value from public.ht_agent_outcomes");
  const begin = await value("select public.prox_shadow_outcome_worker_begin($1) as value", [worker]);
  assert.equal(begin.allowed, true);
  const overlap = await value("select public.prox_shadow_outcome_worker_begin($1) as value", [randomUUID()]);
  assert.equal(overlap.allowed, false);
  assert.equal(overlap.reason, "worker_in_progress");
  const finish = await value("select public.prox_shadow_outcome_worker_finish($1,$2::jsonb) as value", [
    worker, JSON.stringify({ success: true }),
  ]);
  assert.equal(finish.ok, true);
  assert.equal(await value("select count(*) as value from public.ht_agent_outcomes"), before);
});
