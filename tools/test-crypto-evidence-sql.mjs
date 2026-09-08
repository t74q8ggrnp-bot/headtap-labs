// Isolated PostgreSQL only. No production connection, credentials, or provider requests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!isAbsolute(process.argv[2] ?? "")) throw new Error("Provide a local absolute PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const migration = await readFile(new URL("../supabase/migrations/0036_crypto_research_evidence_integrity.sql", import.meta.url), "utf8");
const base = Date.now() - 7_200_000;
const at = seconds => new Date(base + seconds * 1_000).toISOString();
const marketId = "COINBASE_SPOT_TEST_USD";
const identity = { provider: "coinapi", marketId, base: "TEST", quote: "USD" };
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
const count = table => scalar(`select count(*)::int as result from public.${table}`);
const frame = (seconds, bid = 10, options = {}) => {
  const decisionAt = at(seconds);
  const sourceAt = at(options.sourceSeconds ?? seconds);
  const book = { symbolId: options.marketId ?? marketId, bid, ask: bid + .01, bidSize: 1000, askSize: 1000, asOf: sourceAt };
  return { version: "coinapi-vercel-pilot-v1", provider: "coinapi", authority: "research_only",
    dataContractVersion: "coinapi-research-data-v2", executionAuthorized: false, publicRankingChanged: false,
    decisionAt, selectedMarkets: options.selected === false ? [] : [marketId],
    quotes: [{ marketId: options.marketId ?? marketId, book: options.noBook ? null : book, failures: [] }],
    evidence: [{ identity, decisionAt, trade: { price: bid, asOf: sourceAt }, book: options.noBook ? null : book }],
    research: { decisions: [{ identity, policyVersion: "crypto-live-research-v1", state: "mixed", score: 50 }] } };
};
async function publish(payload) {
  const id = randomUUID();
  await db.query("insert into public.ht_coinapi_pilot_cycles(id,minute_at,status) values($1,$2,'running')", [id,payload.decisionAt]);
  await db.query("update public.ht_coinapi_pilot_cycles set status='complete', frame=$2::jsonb,evidence_sha256=$3,completed_at=now() where id=$1",
    [id,JSON.stringify(payload),"a".repeat(64)]);
  return id;
}
test.before(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const file of ["0011_crypto_prox_observation_history.sql","0012_crypto_multivenue_discovery.sql","0035_coinapi_vercel_pilot.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.query(`insert into public.ht_crypto_prox_observations(product_id,symbol,observed_at,observation_minute,
    role,rank,entry_price,canonical_score,methodology_version,target_15m_at,target_1h_at,target_4h_at,target_24h_at,
    price_15m,return_15m_percent) values('TEST-USD','TEST',$1,$1,'radar',1,10,50,'legacy',$1,$1,$1,$1,20,100)`, [at(0)]);
  await db.exec(migration);
  await db.exec(migration);
});
test.after(() => db.close());
test.beforeEach(async () => {
  await db.exec(`delete from public.ht_crypto_research_outcomes; delete from public.ht_crypto_research_episodes;
    delete from public.ht_crypto_research_books; delete from public.ht_coinapi_pilot_cycles;`);
});

test("migration quarantines legacy evidence without deleting or falsifying its old values", async () => {
  assert.equal(await count("ht_crypto_legacy_outcome_quarantine"),1);
  assert.equal(await scalar("select evaluation_eligible as result from public.ht_crypto_legacy_outcome_quarantine"),false);
  assert.equal(Number(await scalar("select price_15m as result from public.ht_crypto_prox_observations")),20);
  assert.equal(await scalar("select enabled as result from public.ht_coinapi_pilot_control"),false);
  await assert.rejects(db.exec("update public.ht_crypto_prox_observations set price_15m=30"),/quarantined/);
  await db.exec("update public.ht_crypto_prox_observations set updated_at=now()");
});

test("publication atomically records all selected decisions including unavailable/no-trade cases", async () => {
  await publish(frame(0,10,{noBook:true}));
  assert.equal(await count("ht_crypto_research_episodes"),1);
  assert.equal(await count("ht_crypto_research_outcomes"),4);
  assert.equal(await scalar("select count(*)::int as result from public.ht_crypto_research_outcomes where status='unavailable' and gross_quote_return_percent is null"),4);
});

test("repeated scans preserve one first episode per market/hour, not repeated wins", async () => {
  // Keep both observations within the same UTC hour.
  const first = Math.ceil(base / 3_600_000) * 3_600_000 - base;
  const start = first / 1000 + 1;
  await publish(frame(start)); await publish(frame(start + 60));
  assert.equal(await count("ht_crypto_research_episodes"),1);
  assert.equal(await count("ht_crypto_research_outcomes"),4);
  assert.equal(await count("ht_crypto_research_books"),2);
});

test("each horizon uses its own saved quote even when resolving long afterward", async () => {
  await publish(frame(0)); await publish(frame(900,12,{selected:false}));
  await publish(frame(3_600,11,{selected:false}));
  await publish(frame(4_000,20,{selected:false}));
  const rows = (await db.query("select horizon_seconds,status,gross_quote_return_percent::float8 as value from public.ht_crypto_research_outcomes order by horizon_seconds")).rows;
  assert.equal(rows[1].status,"observed"); assert.ok(Math.abs(rows[1].value - (12 / 10.01 - 1) * 100) < 1e-8);
  assert.equal(rows[3].status,"observed"); assert.ok(Math.abs(rows[3].value - (11 / 10.01 - 1) * 100) < 1e-8);
  assert.equal(rows[0].status,"unavailable"); assert.equal(rows[0].value,null);
});

test("late current quote and same-symbol different venue cannot fill a missing horizon", async () => {
  await publish(frame(0));
  await publish(frame(900,12,{selected:false,marketId:"KRAKEN_SPOT_TEST_USD"}));
  await publish(frame(1_100,20,{selected:false}));
  assert.equal(await scalar("select status as result from public.ht_crypto_research_outcomes where horizon_seconds=900"),"unavailable");
  assert.equal(await scalar("select gross_quote_return_percent as result from public.ht_crypto_research_outcomes where horizon_seconds=900"),null);
});

test("stale entry and conflicting exit quote versions are excluded", async () => {
  await publish(frame(0,10,{sourceSeconds:-30}));
  assert.equal(await scalar("select entry_status as result from public.ht_crypto_research_episodes"),"unavailable");
  await db.exec("delete from public.ht_crypto_research_outcomes; delete from public.ht_crypto_research_episodes; delete from public.ht_crypto_research_books; delete from public.ht_coinapi_pilot_cycles");
  await publish(frame(0)); await publish(frame(900,12,{selected:false}));
  await publish(frame(901,13,{selected:false,sourceSeconds:900}));
  await publish(frame(1_100,20,{selected:false}));
  assert.equal(await scalar("select reason as result from public.ht_crypto_research_outcomes where horizon_seconds=900"),"conflicting_horizon_books");
});

test("unbilled maintenance resolves missing due horizons after collection budget pauses", async () => {
  await publish(frame(0));
  const receipt = await scalar("select public.ht_coinapi_research_maintenance() as result");
  assert.equal(receipt.providerRequests,0); assert.equal(receipt.executionAuthorized,false);
  assert.equal(await scalar("select count(*)::int as result from public.ht_crypto_research_outcomes where status='pending'"),0);
});

test("later conflicts quarantine previously observed outcomes without rewriting the ledger", async () => {
  await publish(frame(0)); await publish(frame(900,12,{selected:false}));
  await publish(frame(1100,20,{selected:false}));
  assert.equal(await scalar("select evaluation_eligible as result from public.ht_crypto_verified_research_outcomes where horizon_seconds=900"),true);
  await publish(frame(1200,13,{selected:false,sourceSeconds:900}));
  assert.equal(await scalar("select status as result from public.ht_crypto_research_outcomes where horizon_seconds=900"),"observed");
  assert.equal(await scalar("select gross_quote_return_percent as result from public.ht_crypto_verified_research_outcomes where horizon_seconds=900"),null);
  assert.equal(await scalar("select evaluation_eligible as result from public.ht_crypto_verified_research_outcomes where horizon_seconds=900"),false);
});

test("entry evidence must match its exact saved book, not merely a similar timestamp", async () => {
  const wrong = frame(0); wrong.evidence[0].book = { ...wrong.evidence[0].book,ask:1 };
  await publish(wrong);
  assert.equal(await scalar("select entry_status as result from public.ht_crypto_research_episodes"),"unavailable");
  const wrongIdentity = frame(1); wrongIdentity.quotes[0].book.symbolId = "KRAKEN_SPOT_TEST_USD";
  await assert.rejects(publish(wrongIdentity),/identity mismatch/);
});

test("invalid evidence rolls back the complete publication and its partial ledger writes", async () => {
  const invalid = frame(0); invalid.quotes[0].book.ask = -1;
  await assert.rejects(publish(invalid));
  assert.equal(await count("ht_crypto_research_books"),0);
  assert.equal(await count("ht_crypto_research_episodes"),0);
  assert.equal(await scalar("select status as result from public.ht_coinapi_pilot_cycles"),"running");
});

test("anonymous clients cannot read evidence; service cannot invent or rewrite outcomes", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(count("ht_crypto_research_books"));
    await assert.rejects(db.exec("select public.ht_coinapi_research_maintenance()"));
  } finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try {
    assert.equal(await count("ht_crypto_research_books"),0);
    await assert.rejects(db.exec("update public.ht_crypto_research_outcomes set gross_quote_return_percent=100"));
    await assert.rejects(db.query("select public.ht_coinapi_resolve_saved_outcomes($1::timestamptz)",[at(1_000_000)]));
  } finally { await db.exec("reset role"); }
});
