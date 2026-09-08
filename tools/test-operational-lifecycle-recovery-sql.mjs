// Isolated PostgreSQL only: no credentials, production mutations or provider calls.
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
const readTool = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
const recovery = () => value("select public.ht_coinapi_recover_bounded_timeouts() as value");
const accounting = () => value("select public.ht_coinapi_pilot_accounting_snapshot() as value");
const path = "/v1/ohlcv/COINBASE_SPOT_STX_USD/latest?period_id=1MIN&limit=65";

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
  ]) await db.exec(await read(name));
});
test.after(() => db.close());

test.beforeEach(async () => {
  await db.exec(`
    delete from public.ht_coinapi_unsettled_cost_holds;
    delete from public.ht_coinapi_pilot_cost_holds;
    delete from public.ht_coinapi_pilot_requests;
    delete from public.ht_coinapi_pilot_cycles;
    update public.ht_coinapi_pilot_control set enabled=true,blocked_reason=null,lease_id=null,lease_until=null,
      latest_cycle_id=null,daily_reserved=0,lifetime_reserved=0,daily_credit_limit=300,lifetime_credit_limit=900;
    delete from public.ht_agent_runs;
    delete from public.ht_agent_profiles;
    delete from public.paper_accounts;
    delete from auth.users;
  `);
});

async function insertUnsettled(overrides = {}) {
  const cycle = randomUUID(), request = randomUUID();
  await db.query("insert into public.ht_coinapi_pilot_cycles(id,minute_at,started_at,completed_at,status,error_code) values($1,now()-interval '6 minutes',now()-interval '6 minutes',now()-interval '5 minutes','failed','collection_or_accounting_failed')", [cycle]);
  await db.query("insert into public.ht_coinapi_pilot_requests(id,cycle_id,path,reserved_at) values($1,$2,$3,now()-interval '5 minutes')", [request, cycle, overrides.path ?? path]);
  await db.exec("update public.ht_coinapi_pilot_control set blocked_reason='unsettled_provider_usage',daily_reserved=1,lifetime_reserved=1");
  return { cycle, request };
}

test("an eligible unsettled write is held at full cost without rewriting its raw receipt", async () => {
  const { request } = await insertUnsettled();
  const before = await value("select to_jsonb(r) as value from public.ht_coinapi_pilot_requests r where id=$1", [request]);
  const result = await recovery();
  assert.equal(result.recovered, true);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.newUnsettledHolds, 1);
  assert.deepEqual(await value("select to_jsonb(r) as value from public.ht_coinapi_pilot_requests r where id=$1", [request]), before);
  assert.equal(await value("select blocked_reason as value from public.ht_coinapi_pilot_control where id='global'"), null);
  const proof = await accounting();
  assert.equal(proof.version, "coinapi-accounting-holds-v2");
  assert.equal(proof.heldUnsettledRequests, 1);
  assert.equal(proof.heldMaximumCredits, 1);
  assert.equal(proof.rawUnsettledRequests, 1);
  assert.equal(proof.unaccountedRequests, 0);
  assert.equal(proof.reservationCovered, true);
  assert.equal((await value("select public.ht_coinapi_pilot_begin($1) as value", [randomUUID()])).allowed, true);
  assert.equal((await value("select public.ht_coinapi_pilot_settle($1,1,200) as value", [request])).reason, "accounting_hold_finalized");
});

test("unsupported, young, active, access-error or under-reserved requests stay blocked", async () => {
  for (const mutation of [
    "update public.ht_coinapi_pilot_requests set path=path||'&unknown=true'",
    "update public.ht_coinapi_pilot_requests set reserved_at=clock_timestamp()",
    "update public.ht_coinapi_pilot_requests set http_status=429",
    "update public.ht_coinapi_pilot_control set lifetime_reserved=0",
  ]) {
    await db.exec("begin");
    try {
      await insertUnsettled();
      await db.exec(mutation);
      assert.equal((await recovery()).recovered, false, mutation);
    } finally { await db.exec("rollback"); }
  }
  await db.exec("begin");
  try {
    const { cycle } = await insertUnsettled();
    await db.query("update public.ht_coinapi_pilot_cycles set status='running',completed_at=null where id=$1", [cycle]);
    await db.query("update public.ht_coinapi_pilot_control set lease_id=$1,lease_until=clock_timestamp()+interval '1 minute'", [cycle]);
    assert.equal((await recovery()).reason, "disabled_or_active_cycle");
  } finally { await db.exec("rollback"); }
});

test("a currently leased request is not mistaken for historical unaccounted usage", async () => {
  const cycle = randomUUID(), request = randomUUID();
  await db.query("insert into public.ht_coinapi_pilot_cycles(id,minute_at,status) values($1,date_trunc('minute',now()),'running')", [cycle]);
  await db.query("insert into public.ht_coinapi_pilot_requests(id,cycle_id,path) values($1,$2,$3)", [request, cycle, path]);
  await db.query("update public.ht_coinapi_pilot_control set lease_id=$1,lease_until=clock_timestamp()+interval '1 minute',daily_reserved=1,lifetime_reserved=1", [cycle]);
  assert.equal(await value("select public.ht_coinapi_request_usage_blocking($1) as value", [request]), false);
  const proof = await accounting();
  assert.equal(proof.activeUnsettledRequests, 1);
  assert.equal(proof.unaccountedRequests, 1);
});

test("the database permits only one running Agent cycle per profile", async () => {
  const user = randomUUID(), account = randomUUID(), profile = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("insert into public.paper_accounts(id,user_id) values($1,$2)", [account, user]);
  await db.query("insert into public.ht_agent_profiles(id,user_id,paper_account_id,mode) values($1,$2,$3,'observe')", [profile, user, account]);
  await db.query("insert into public.ht_agent_runs(profile_id,user_id,mode) values($1,$2,'observe')", [profile, user]);
  await assert.rejects(db.query("insert into public.ht_agent_runs(profile_id,user_id,mode) values($1,$2,'observe')", [profile, user]));
  const health = await value("select public.ht_agent_lifecycle_health() as value");
  assert.equal(health.oneRunningIndexInstalled, true);
  assert.equal(health.duplicateRunningProfiles, 0);
});

test("the release verification is read-only and reports both lifecycle guards", async () => {
  const before = await value("select to_jsonb(c) as value from public.ht_coinapi_pilot_control c");
  const verification = await db.query(await readTool("verify-operational-lifecycle-0045.sql"));
  const proof = verification.rows[0].operational_lifecycle_verification;
  assert.equal(proof.migration_0045.unsettled_hold_table_installed, true);
  assert.equal(proof.migration_0045.one_running_agent_index_installed, true);
  assert.equal(proof.coinapi_accounting.version, "coinapi-accounting-holds-v2");
  assert.equal(proof.agent_lifecycle.oneRunningIndexInstalled, true);
  assert.equal(proof.execution_authority.live_brokerage, false);
  assert.equal(proof.provider_requests, 0);
  assert.deepEqual(await value("select to_jsonb(c) as value from public.ht_coinapi_pilot_control c"), before);
});

test("migration reruns preserve holds, reservations and Agent history", async () => {
  await insertUnsettled();
  await recovery();
  const beforeRequest = await value("select jsonb_agg(to_jsonb(r)) as value from public.ht_coinapi_pilot_requests r");
  const beforeControl = await value("select to_jsonb(c) as value from public.ht_coinapi_pilot_control c");
  await db.exec(await read("0045_operational_lifecycle_recovery.sql"));
  assert.deepEqual(await value("select jsonb_agg(to_jsonb(r)) as value from public.ht_coinapi_pilot_requests r"), beforeRequest);
  assert.deepEqual(await value("select to_jsonb(c) as value from public.ht_coinapi_pilot_control c"), beforeControl);
});
