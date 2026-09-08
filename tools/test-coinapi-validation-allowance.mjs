// Local PostgreSQL only; no production connection and no provider requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

if (!isAbsolute(process.argv[2] ?? '')) throw Error('Provide the existing local PGlite module path');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const schema = await readFile(new URL('../supabase/migrations/0035_coinapi_vercel_pilot.sql', import.meta.url), 'utf8');
const source = await readFile(new URL('./coinapi-validation-100.sql', import.meta.url), 'utf8');
// The production script expires after the specific approval date. Local fixtures
// substitute only that literal to keep the regression tests runnable later.
const approval = source.replaceAll("date '2026-09-03'", "(clock_timestamp() at time zone 'UTC')::date");
let db;
test.beforeEach(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(schema);
  await db.exec(`update ht_coinapi_pilot_control set enabled=true, daily_credit_limit=900,
    daily_reserved=900, lifetime_reserved=900, state='{"cursor":17,"candleHistory":{"preserved":true}}';`);
});
test.afterEach(async () => { await db.close(); });
const control = async () => (await db.query('select * from ht_coinapi_pilot_control')).rows[0];
test('approval changes only two ceilings and updated_at, preserving evidence and used credits', async () => {
  const before = await control();
  await db.exec(approval);
  const after = await control();
  assert.equal(after.daily_credit_limit, 1000);
  assert.equal(after.lifetime_credit_limit, 1000);
  for (const key of Object.keys(before).filter(k => !['daily_credit_limit','lifetime_credit_limit','updated_at'].includes(k))) {
    assert.deepEqual(after[key], before[key]);
  }
});
test('rerunning cannot replenish used credits or clear a later block', async () => {
  await db.exec(approval);
  await db.exec("update ht_coinapi_pilot_control set daily_reserved=925,lifetime_reserved=925,blocked_reason='provider_access_blocked',enabled=false");
  const before = await control();
  await db.exec(approval);
  assert.deepEqual(await control(), before);
});
test('unapproved baseline rolls back without changing either constraint or usage', async () => {
  await db.exec('update ht_coinapi_pilot_control set lifetime_reserved=899');
  const before = await control();
  await assert.rejects(db.exec(approval), /expected the verified/);
  await db.exec('rollback');
  assert.deepEqual(await control(), before);
  await assert.rejects(db.exec('update ht_coinapi_pilot_control set lifetime_credit_limit=1000'), /check constraint/);
});
test('an operational block is never cleared to start the test', async () => {
  await db.exec("update ht_coinapi_pilot_control set blocked_reason='unknown_provider_cost'");
  await assert.rejects(db.exec(approval), /disabled, blocked, busy/);
  await db.exec('rollback');
  assert.equal((await control()).lifetime_credit_limit, 900);
  assert.equal((await control()).blocked_reason, 'unknown_provider_cost');
});
test('the 100th extra request is allowed; the next is blocked before any provider call', async () => {
  await db.exec(approval);
  await db.exec('update ht_coinapi_pilot_control set daily_reserved=999,lifetime_reserved=999');
  const cycle = randomUUID();
  assert.equal((await db.query('select ht_coinapi_pilot_begin($1) as r',[cycle])).rows[0].r.allowed,true);
  const request = randomUUID();
  const last = (await db.query('select ht_coinapi_pilot_reserve($1,$2,$3) as r',
    [cycle,request,'/v1/quotes/current?filter_exchange_id=COINBASE'])).rows[0].r;
  assert.equal(last.allowed,true);
  const denied = (await db.query('select ht_coinapi_pilot_reserve($1,$2,$3) as r',
    [cycle,randomUUID(),'/v1/ohlcv/COINBASE_SPOT_BTC_USD/latest?period_id=1MIN&limit=65'])).rows[0].r;
  assert.equal(denied.reason,'credit_budget_reached');
  assert.equal(Number((await control()).lifetime_reserved),1000);
  await assert.rejects(db.exec('update ht_coinapi_pilot_control set lifetime_credit_limit=1001'), /check constraint/);
});
