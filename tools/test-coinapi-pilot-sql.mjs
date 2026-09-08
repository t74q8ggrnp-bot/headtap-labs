// Isolated PostgreSQL (PGlite) tests. Never connects to Supabase or any live account.
// Usage: node tools/test-coinapi-pilot-sql.mjs /absolute/path/to/pglite/dist/index.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
import test from "node:test";

const modulePath = process.argv[2];
if (!modulePath || !isAbsolute(modulePath)) throw new Error("Provide the absolute local path of an isolated PGlite module.");
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = await readFile(new URL("../supabase/migrations/0035_coinapi_vercel_pilot.sql", import.meta.url), "utf8");
test.before(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(migration);
  // Reapplying must not reset an account's allowance or enable collection.
  await db.exec(migration);
});
test.after(async () => { await db.close(); });
test.beforeEach(async () => {
  await db.exec(`delete from public.ht_coinapi_pilot_requests;
    delete from public.ht_coinapi_pilot_cycles;
    update public.ht_coinapi_pilot_control set enabled = false, daily_credit_limit = 300,
      lifetime_credit_limit = 900, credit_day = (now() at time zone 'UTC')::date,
      daily_reserved = 0, lifetime_reserved = 0, blocked_reason = null, lease_id = null,
      lease_until = null, state = null, latest_cycle_id = null where id = 'global';`);
});

const scalar = async (query, args = []) => (await db.query(query, args)).rows[0].result;
const control = () => scalar("select to_jsonb(c) as result from public.ht_coinapi_pilot_control c");
const begin = (id) => scalar("select public.ht_coinapi_pilot_begin($1::uuid) as result", [id]);
const enable = () => db.exec("update public.ht_coinapi_pilot_control set enabled = true where id = 'global'");
const reserve = (cycle, id, path = "/v1/quotes/current?filter_exchange_id=COINBASE") => scalar(
  "select public.ht_coinapi_pilot_reserve($1::uuid,$2::uuid,$3::text) as result", [cycle, id, path]);
const settle = (id, cost = 1, status = 200) => scalar(
  "select public.ht_coinapi_pilot_settle($1::uuid,$2::numeric,$3::integer) as result", [id, cost, status]);
const frame = { version: "coinapi-vercel-pilot-v1", provider: "coinapi", authority: "research_only",
  executionAuthorized: false, publicRankingChanged: false };
const finish = (cycle, payload = frame, error = null) => scalar(
  "select public.ht_coinapi_pilot_finish($1::uuid,$2::jsonb,$3::jsonb,$4::text,$5::text) as result",
  [cycle, JSON.stringify({ cursor: 1 }), JSON.stringify(payload), "a".repeat(64), error]);

test("schema starts disabled; migration rerun never replenishes credit usage", async () => {
  assert.equal((await begin(randomUUID())).reason, "disabled");
  await db.exec("update public.ht_coinapi_pilot_control set lifetime_reserved = 87");
  await db.exec(migration);
  assert.equal(Number((await control()).lifetime_reserved), 87);
  assert.equal((await control()).enabled, false);
});

test("two competing cron claims have only one winner", async () => {
  await enable();
  const claims = await Promise.all([begin(randomUUID()), begin(randomUUID())]);
  assert.equal(claims.filter(c => c.allowed).length, 1);
  assert.equal(claims.filter(c => c.reason === "cycle_in_progress").length, 1);
});

test("duplicate request cannot consume another credit; wrong lease cannot reserve", async () => {
  await enable(); const c = randomUUID(); await begin(c);
  assert.equal((await reserve(randomUUID(), randomUUID())).allowed, false);
  assert.equal((await reserve(c, randomUUID())).allowed, true);
  assert.equal((await reserve(c, randomUUID())).reason, "duplicate_or_cycle_limit");
  assert.equal(Number((await control()).lifetime_reserved), 1);
});

test("daily and lifetime limits stop reservations before network spending", async () => {
  await enable();
  await db.exec("update public.ht_coinapi_pilot_control set daily_credit_limit = 1, lifetime_credit_limit = 1");
  const c = randomUUID(); await begin(c);
  await reserve(c, randomUUID());
  assert.equal((await reserve(c, randomUUID(), "/v1/symbols?filter_exchange_id=COINBASE")).reason, "credit_budget_reached");
  assert.equal(Number((await control()).lifetime_reserved), 1);
});

test("repeated receipt does not double-charge or refund a reservation", async () => {
  await enable(); const c = randomUUID(), r = randomUUID(); await begin(c); await reserve(c, r);
  assert.equal((await settle(r, 0)).allowed, true);
  assert.equal((await settle(r, 1)).reason, "receipt_already_settled");
  assert.equal(Number((await control()).lifetime_reserved), 1);
});

for (const cost of [null, -1, 2]) {
  test(`unknown/excess cost ${cost} permanently blocks further collection`, async () => {
    await enable(); const c = randomUUID(), r = randomUUID(); await begin(c); await reserve(c, r);
    assert.equal((await settle(r, cost)).allowed, false);
    assert.ok((await control()).blocked_reason);
    assert.equal((await reserve(c, randomUUID(), "/v1/symbols?filter_exchange_id=COINBASE")).allowed, false);
    assert.equal(Number((await control()).lifetime_reserved), cost === 2 ? 2 : 1);
    await assert.rejects(finish(c));
  });
}

test("401/403/429 blocks subsequent calls even with an ordinary cost receipt", async () => {
  await enable(); const c = randomUUID(), r = randomUUID(); await begin(c); await reserve(c, r);
  await settle(r, 1, 429);
  assert.equal((await control()).blocked_reason, "provider_access_blocked");
});

test("crashed worker's unresolved reservation is not retried after lease expiration", async () => {
  await enable(); const c = randomUUID(); await begin(c); await reserve(c, randomUUID());
  await db.exec("update public.ht_coinapi_pilot_control set lease_until = now() - interval '1 second'");
  assert.equal((await begin(randomUUID())).reason, "unsettled_provider_usage");
  assert.equal(Number((await control()).lifetime_reserved), 1);
});

test("publication is atomic and a completed frame cannot be replaced", async () => {
  await enable(); const c = randomUUID(), r = randomUUID(); await begin(c); await reserve(c, r); await settle(r);
  await finish(c);
  assert.equal((await control()).latest_cycle_id, c);
  assert.deepEqual((await control()).state, { cursor: 1 });
  assert.equal(await scalar("select status as result from public.ht_coinapi_pilot_cycles where id = $1::uuid", [c]), "complete");
  await assert.rejects(finish(c));
  assert.equal((await begin(randomUUID())).reason, "minute_already_attempted");
});

test("failure does not advance the latest publication; incomplete usage cannot publish", async () => {
  await enable(); const c = randomUUID(); await begin(c); await reserve(c, randomUUID());
  await assert.rejects(finish(c));
  await finish(c, null, "test_failure");
  assert.equal((await control()).latest_cycle_id, null);
  assert.equal((await control()).state, null);
});

test("publication rejects another provider or execution/public ranking authority", async () => {
  await enable(); const c = randomUUID(); await begin(c);
  for (const changes of [{ provider: "massive" }, { executionAuthorized: true }, { publicRankingChanged: true }, { authority: "public" }]) {
    await assert.rejects(finish(c, { ...frame, ...changes }));
  }
});

test("UTC daily rollover does not replenish the lifetime trial allowance", async () => {
  await enable();
  await db.exec(`update public.ht_coinapi_pilot_control set daily_reserved = 300, lifetime_reserved = 900,
    credit_day = ((now() at time zone 'UTC')::date - 1)`);
  assert.equal((await begin(randomUUID())).reason, "credit_budget_reached");
  assert.equal(Number((await control()).daily_reserved), 0);
  assert.equal(Number((await control()).lifetime_reserved), 900);
});

test("kill switch prevents already-running worker from reserving or publishing", async () => {
  await enable(); const c = randomUUID(); await begin(c);
  await db.exec("update public.ht_coinapi_pilot_control set enabled = false");
  assert.equal((await reserve(c, randomUUID())).allowed, false);
  await assert.rejects(finish(c));
});

test("anonymous users cannot read pilot tables or execute budget RPCs", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(control());
    await assert.rejects(begin(randomUUID()));
  } finally { await db.exec("reset role"); }
});

test("service role can use protected RPCs but cannot overwrite journal rows", async () => {
  await enable();
  await db.exec("set role service_role");
  try {
    assert.equal((await begin(randomUUID())).allowed, true);
    await assert.rejects(db.exec("update public.ht_coinapi_pilot_cycles set error_code = 'tampered'"));
    await assert.rejects(db.exec("delete from public.ht_coinapi_pilot_requests"));
  } finally { await db.exec("reset role"); }
});
