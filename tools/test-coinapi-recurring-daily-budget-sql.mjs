// Isolated PostgreSQL only: no credentials, production writes, or provider requests.
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
const row = async () => (await db.query("select * from public.ht_coinapi_pilot_control where id='global'" )).rows[0];
const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].value;

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
  await db.exec(`
    alter table public.ht_coinapi_pilot_control
      drop constraint ht_coinapi_pilot_control_daily_credit_limit_check,
      drop constraint ht_coinapi_pilot_control_lifetime_credit_limit_check;
    alter table public.ht_coinapi_pilot_control
      add constraint ht_coinapi_pilot_control_daily_credit_limit_check check (daily_credit_limit between 1 and 1000),
      add constraint ht_coinapi_pilot_control_lifetime_credit_limit_check check (lifetime_credit_limit between 1 and 1000);
    update public.ht_coinapi_pilot_control set enabled=true,daily_credit_limit=1000,lifetime_credit_limit=1000,
      credit_day=(now() at time zone 'UTC')::date,daily_reserved=0,lifetime_reserved=1000;
  `);
  await db.exec(await read("0047_coinapi_recurring_daily_budget.sql"));
});
test.after(() => db.close());

test("activation grants only today's unused allowance and preserves cumulative accounting",async()=>{
  const c=await row();
  assert.equal(c.daily_auto_renew,true);
  assert.equal(Number(c.daily_reserved),0);
  assert.equal(Number(c.lifetime_reserved),1000);
  assert.equal(c.lifetime_credit_limit,2000);
  assert.equal((await scalar("select public.ht_coinapi_pilot_begin($1) as value",[randomUUID()])).allowed,true);
});

test("rerunning the migration is idempotent",async()=>{
  await db.exec("update public.ht_coinapi_pilot_control set lease_id=null,lease_until=null");
  await db.exec("update public.ht_coinapi_pilot_cycles set status='failed',completed_at=now(),error_code='test_cleanup' where status='running'");
  const before=await row();
  await db.exec(await read("0047_coinapi_recurring_daily_budget.sql"));
  const after=await row();
  assert.equal(after.lifetime_credit_limit,before.lifetime_credit_limit);
  assert.equal(Number(after.lifetime_reserved),Number(before.lifetime_reserved));
  assert.equal(Number(after.daily_reserved),Number(before.daily_reserved));
});

test("UTC rollover grants one fresh daily envelope and never carries unused requests",async()=>{
  await db.exec("delete from public.ht_coinapi_pilot_requests; delete from public.ht_coinapi_pilot_cycles; update public.ht_coinapi_pilot_control set credit_day=(now() at time zone 'UTC')::date-1,daily_reserved=125,lifetime_reserved=1125,lease_id=null,lease_until=null");
  const cycle=randomUUID();
  const result=await scalar("select public.ht_coinapi_pilot_begin($1) as value",[cycle]);
  assert.equal(result.allowed,true);
  const c=await row();
  assert.equal(Number(c.daily_reserved),0);
  assert.equal(Number(c.lifetime_reserved),1125);
  assert.equal(c.lifetime_credit_limit,2125);
});

test("the hard daily cap blocks request 1001 before a provider call",async()=>{
  await db.exec("delete from public.ht_coinapi_pilot_requests; delete from public.ht_coinapi_pilot_cycles; update public.ht_coinapi_pilot_control set lease_id=null,lease_until=null,daily_reserved=999,lifetime_reserved=1999,lifetime_credit_limit=2000");
  const cycle=randomUUID();
  assert.equal((await scalar("select public.ht_coinapi_pilot_begin($1) as value",[cycle])).allowed,true);
  assert.equal((await scalar("select public.ht_coinapi_pilot_reserve($1,$2,$3) as value",[cycle,randomUUID(),"/v1/quotes/current?filter_exchange_id=COINBASE"])).allowed,true);
  const denied=await scalar("select public.ht_coinapi_pilot_reserve($1,$2,$3) as value",[cycle,randomUUID(),"/v1/ohlcv/COINBASE_SPOT_BTC_USD/latest?period_id=1MIN&limit=65"]);
  assert.equal(denied.reason,"credit_budget_reached");
  const c=await row();
  assert.equal(Number(c.daily_reserved),1000);
  assert.equal(Number(c.lifetime_reserved),2000);
});
