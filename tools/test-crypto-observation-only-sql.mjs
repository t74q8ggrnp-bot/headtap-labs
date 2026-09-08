// Isolated PostgreSQL regression tests. No credentials, network or production writes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!isAbsolute(process.argv[2] ?? "")) throw new Error("Provide an absolute local PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const migration = await read("supabase/migrations/0037_crypto_legacy_observation_only.sql");
const activation = await read("tools/enable-coinapi-pilot.sql");
const rows = async sql => (await db.query(sql)).rows;
const scalar = async sql => (await rows(sql))[0].value;
const families = [
  { table:"ht_crypto_prox_observations", identity:"product_id", price:"price_15m",
    columns:"product_id,symbol,role,rank,entry_price,canonical_score,methodology_version",
    values:"'TEST-USD','TEST','radar',1,10,50,'legacy'" },
  { table:"ht_crypto_discovery_observations", identity:"asset_id", price:"price_15m_usd",
    columns:"asset_id,symbol,rank,entry_price_usd,proposed_opportunity_score,observed_move_percent,dollar_volume,venue_count,methodology_version",
    values:"'crypto:coinbase:TEST','TEST',1,10,50,5,10000,1,'legacy'" },
];
const targets = "target_15m_at,target_1h_at,target_4h_at,target_24h_at";
const targetValues = "now()-interval '2 hours',now()-interval '1 hour',now()+interval '2 hours',now()+interval '22 hours'";
const originals = new Map();
test.before(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const file of ["0011_crypto_prox_observation_history.sql","0012_crypto_multivenue_discovery.sql","0035_coinapi_vercel_pilot.sql"]) {
    await db.exec(await read(`supabase/migrations/${file}`));
  }
  for (const family of families) {
    await db.exec(`grant select,insert,update,delete,truncate on public.${family.table} to service_role;
      insert into public.${family.table}(${family.columns},observed_at,observation_minute,${targets},${family.price},return_15m_percent)
      values(${family.values},now()-interval '3 hours',now()-interval '3 hours',${targetValues},12,20);
      insert into public.${family.table}(${family.columns},observed_at,observation_minute,${targets})
      values(${family.values},now()-interval '4 hours',now()-interval '4 hours',${targetValues});`);
    originals.set(family.table, await rows(`select to_jsonb(t) as value from public.${family.table} t order by observed_at`));
  }
  await db.exec(await read("supabase/migrations/0036_crypto_research_evidence_integrity.sql"));
  await db.exec(migration);
});
test.after(() => db.close());

test("0037 preserves every historical field and retains old overdue and unverified counts", async () => {
  for (const family of families) {
    const actual = await rows(`select to_jsonb(t) - 'outcome_tracking_status' as value from public.${family.table} t order by observed_at`);
    assert.deepEqual(actual, originals.get(family.table));
    const [summary] = await rows(`select * from public.ht_crypto_legacy_tracking_readiness where source_table='${family.table}'`);
    assert.equal(Number(summary.preserved_legacy_observations),2);
    assert.equal(Number(summary.legacy_overdue_15m),1);
    assert.equal(Number(summary.unverified_recorded_horizons),1);
    assert.equal(summary.evaluation_allowed,false);
  }
});

test("old deployed writers can insert observations but cannot schedule new unusable horizons", async () => {
  for (const family of families) {
    await db.exec(`insert into public.${family.table}(${family.columns},observed_at,observation_minute,${targets})
      values(${family.values},now(),now(),${targetValues})`);
    const [inserted] = await rows(`select * from public.${family.table} where outcome_tracking_status='not_scheduled'`);
    assert.ok(inserted);
    for (const key of targets.split(",")) assert.equal(inserted[key],null);
    assert.equal(inserted[family.price],null);
    assert.equal(inserted.methodology_version,"legacy");
  }
});

test("migration rerun does not reclassify new observations or restart outcome clocks", async () => {
  const before = await rows("select * from public.ht_crypto_legacy_tracking_readiness order by source_table");
  await db.exec(migration);
  assert.deepEqual(await rows("select * from public.ht_crypto_legacy_tracking_readiness order by source_table"),before);
  assert.equal(await scalar("select enabled as value from public.ht_coinapi_pilot_control"),false);
});

test("historical identity, targets, entry and outcome values cannot be overwritten or cleared", async () => {
  for (const family of families) {
    for (const change of ["target_15m_at=null",`${family.identity}='RELABELED'`,"outcome_tracking_status='not_scheduled'",`${family.price}=99`]) {
      await assert.rejects(db.exec(`update public.${family.table} set ${change} where outcome_tracking_status='legacy_quarantined'`),/immutable|quarantined/);
    }
    await db.exec(`update public.${family.table} set updated_at=now()`);
    await assert.rejects(db.exec(`update public.${family.table} set target_15m_at=now() where outcome_tracking_status='not_scheduled'`),/immutable/);
  }
});

test("new writers omit targets; duplicate deliveries cannot revise a stored observation", async () => {
  for (const family of families) {
    await db.exec(`insert into public.${family.table}(${family.columns},observed_at,observation_minute)
      values(${family.values},'2026-09-04T00:00:00Z','2026-09-04T00:00:00Z')`);
    const before = await rows(`select to_jsonb(t) as value from public.${family.table} t order by observed_at`);
    await db.exec(`insert into public.${family.table}(${family.columns},observed_at,observation_minute,${targets})
      values(${family.values},'2026-09-04T00:00:00Z','2026-09-04T00:00:00Z',${targetValues})
      on conflict(${family.identity},observation_minute) do nothing`);
    assert.deepEqual(await rows(`select to_jsonb(t) as value from public.${family.table} t order by observed_at`),before);
  }
});

test("tracking reads remain protected and application roles cannot delete old evidence", async () => {
  for (const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(rows("select * from public.ht_crypto_legacy_tracking_readiness")); }
    finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try {
    assert.equal((await rows("select * from public.ht_crypto_legacy_tracking_readiness")).length,2);
    for (const family of families) {
      await assert.rejects(db.exec(`delete from public.${family.table}`));
      await assert.rejects(db.exec(`truncate public.${family.table}`));
    }
  } finally { await db.exec("reset role"); }
});

test("approved activation preserves budget counters and does not enable any order authority", async () => {
  await db.exec("update public.ht_coinapi_pilot_control set daily_reserved=17,lifetime_reserved=22");
  await db.exec(activation); await db.exec(activation);
  const [control] = await rows("select * from public.ht_coinapi_pilot_control");
  assert.equal(control.enabled,true);
  assert.equal(Number(control.daily_reserved),17); assert.equal(Number(control.lifetime_reserved),22);
  assert.equal(control.daily_credit_limit,300); assert.equal(control.lifetime_credit_limit,900);
  assert.equal(await scalar("select execution_authorized as value from public.ht_crypto_research_readiness"),false);
  assert.equal(await scalar("select profitability_established as value from public.ht_crypto_research_readiness"),false);
});

test("activation refuses accounting blocks or increased caps without erasing evidence", async () => {
  await db.exec("update public.ht_coinapi_pilot_control set enabled=false,blocked_reason='unknown_provider_cost'");
  await assert.rejects(db.exec(activation),/blocked/); await db.exec("rollback");
  assert.equal(await scalar("select enabled as value from public.ht_coinapi_pilot_control"),false);
  assert.equal(await scalar("select blocked_reason as value from public.ht_coinapi_pilot_control"),"unknown_provider_cost");
  await db.exec("update public.ht_coinapi_pilot_control set blocked_reason=null,daily_credit_limit=600");
  await assert.rejects(db.exec(activation),/exceed/); await db.exec("rollback");
  assert.equal(await scalar("select enabled as value from public.ht_coinapi_pilot_control"),false);
});
