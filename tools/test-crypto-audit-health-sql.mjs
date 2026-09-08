// Real isolated PostgreSQL; no provider requests or production access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
if (!isAbsolute(process.argv[2]??'')) throw new Error('Provide absolute PGlite module path');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
const query=async sql=>(await db.query(sql)).rows;
const snapshot=async()=>(await query('select public.ht_crypto_evidence_health_snapshot() as result'))[0].result;
const projection=process.argv[3]==='0044';
const queued=process.argv[3]==='0043'||projection;
const reliability=process.argv[3]==='0042'||queued;
const queryRepair=process.argv[3]==='0039'||reliability;
const migration=await read('supabase/migrations/0038_crypto_audit_and_health.sql')+
  (queryRepair ? '\n'+await read('supabase/migrations/0039_crypto_audit_query_repair.sql') : '');
let original;
test.before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const f of ['0011_crypto_prox_observation_history.sql','0012_crypto_multivenue_discovery.sql','0035_coinapi_vercel_pilot.sql']) await db.exec(await read('supabase/migrations/'+f));
  await db.exec(`insert into public.ht_crypto_prox_observations(product_id,symbol,observed_at,observation_minute,role,rank,entry_price,canonical_score,methodology_version,target_15m_at,target_1h_at,target_4h_at,target_24h_at,price_15m,return_15m_percent)
    values('TEST-USD','TEST',now(),now(),'radar',1,10,60,'legacy',now(),now(),now(),now(),12,20);
    insert into public.ht_crypto_discovery_observations(asset_id,symbol,observed_at,observation_minute,rank,entry_price_usd,proposed_opportunity_score,observed_move_percent,dollar_volume,venue_count,methodology_version,target_15m_at,target_1h_at,target_4h_at,target_24h_at)
    values('crypto:coinbase:TEST','TEST',now(),now(),1,10,60,5,100000,1,'legacy',now(),now(),now(),now());`);
  for(const f of ['0036_crypto_research_evidence_integrity.sql','0037_crypto_legacy_observation_only.sql']) await db.exec(await read('supabase/migrations/'+f));
  await db.exec(migration);
  if(reliability) {
    await db.exec('create schema auth;create table auth.users(id uuid primary key)');
    for(const f of ['0040_manual_crypto_paper.sql','0041_coinapi_bounded_timeout_recovery.sql','0042_crypto_database_reliability.sql']) await db.exec(await read('supabase/migrations/'+f));
    if(queued) await db.exec(await read('supabase/migrations/0043_crypto_archive_queue.sql'));
    assert.equal((await snapshot()).archive.reduce((sum,a)=>sum+a.evidence_mismatches,0),2);
    await db.exec('select ht_crypto_audit_legacy_evidence()');
    if(projection) {
      await db.exec('begin');
      const before=await snapshot();
      await db.exec(await read('supabase/migrations/0044_crypto_health_projection.sql'));
      assert.deepEqual((await snapshot()).archive,before.archive,'Projection preserves all exhaustive counts and protections');
    }
  }
  original=await query('select source_table,observation_id,original from public.ht_crypto_legacy_audit_inputs order by source_table');
});
test.after(()=>db.close());
test('each historical row gets a specific audit and four unverified horizons without changing its data',async()=>{
  const audits=await query('select * from public.ht_crypto_legacy_evidence_audits');
  assert.equal(audits.length,2);
  for(const a of audits){assert.equal(a.status,'unverifiable_from_saved_evidence');assert.equal(a.evidence.horizons.length,4);assert.equal(a.evaluation_allowed,false);assert.equal(a.evidence.providerRequests,0);assert.equal(a.evidence.externalHistoricalReconstructionAttempted,false);}
  const prox=audits.find(a=>a.source_table==='ht_crypto_prox_observations');
  assert.equal(prox.evidence.horizons[0].storedPrice,12); assert.equal(prox.evidence.horizons[0].storedReturnPercent,20);
  assert.ok(audits.find(a=>a.source_table==='ht_crypto_discovery_observations').evidence.horizons.every(h=>h.storedPrice===null));
});
test('replaying audit and migration preserves data, audit IDs/time and budget control',async()=>{
  const before=await query('select * from public.ht_crypto_legacy_evidence_audits order by source_table');
  const control=await query('select * from public.ht_coinapi_pilot_control');
  await db.exec(migration);
  if(reliability) await db.exec(await read('supabase/migrations/0042_crypto_database_reliability.sql'));
  if(queued) await db.exec(await read('supabase/migrations/0043_crypto_archive_queue.sql'));
  if(projection) await db.exec(await read('supabase/migrations/0044_crypto_health_projection.sql'));
  assert.deepEqual(await query('select * from public.ht_crypto_legacy_evidence_audits order by source_table'),before);
  assert.deepEqual(await query('select source_table,observation_id,original from public.ht_crypto_legacy_audit_inputs order by source_table'),original);
  assert.deepEqual(await query('select * from public.ht_coinapi_pilot_control'),control);
});
test('protected fingerprints expose mutation, deletion and missing verification without rewriting history', {skip:!reliability}, async()=>{
  await db.exec('begin');
  try {
    await db.exec("delete from ht_crypto_legacy_source_fingerprints where source_table='ht_crypto_discovery_observations'");
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_discovery_observations').evidence_mismatches,1);
    await db.exec('select ht_crypto_audit_legacy_evidence()');
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_discovery_observations').evidence_mismatches,0);
    await db.exec('alter table ht_crypto_discovery_observations disable trigger ht_crypto_observation_only');
    await db.exec('update ht_crypto_discovery_observations set entry_price_usd=123');
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_discovery_observations').evidence_mismatches,1);
    await db.exec('select ht_crypto_audit_legacy_evidence()');
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_discovery_observations').evidence_mismatches,1,'audit cannot erase existing mismatches');
    await db.exec('delete from ht_crypto_discovery_observations');
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_discovery_observations').evidence_mismatches,1);
  } finally {await db.exec('rollback');}
});
test('new fingerprint protection cannot be disabled or write-enabled without failing health', {skip:!reliability},async()=>{
  await db.exec('begin');
  try {
    await db.exec('alter table ht_crypto_prox_observations disable trigger ht_crypto_fingerprint_guard');
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').guards_enabled,false);
    await db.exec('grant update on ht_crypto_legacy_source_fingerprints to service_role');
    assert.ok((await snapshot()).archive.every(a=>a.deletion_protected===false));
  }finally{await db.exec('rollback');}
});
test('queue processing is idempotent and does not rescan completed history', {skip:!queued},async()=>{
  assert.equal((await query('select ht_crypto_audit_legacy_evidence(500) as n'))[0].n,0);
  assert.equal((await query('select count(*)::int as n from ht_crypto_legacy_audit_queue'))[0].n,0);
  const definition=(await query("select pg_get_functiondef('ht_crypto_audit_legacy_evidence(integer)'::regprocedure) as body"))[0].body;
  assert.match(definition,/from public.ht_crypto_legacy_audit_queue q/);
  assert.match(definition,/for update of q skip locked/);
  assert.doesNotMatch(definition,/not exists/);
});
test('failed audit rolls back queue removal and source fingerprint writes together', {skip:!queued},async()=>{
  await db.exec('begin');
  try {
    await db.exec("delete from ht_crypto_legacy_evidence_audits where source_table='ht_crypto_discovery_observations'; delete from ht_crypto_legacy_source_fingerprints where source_table='ht_crypto_discovery_observations';");
    await db.exec("create function public.test_archive_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic failure'; end$$; create trigger test_archive_failure before insert on ht_crypto_legacy_evidence_audits for each row execute function public.test_archive_failure();");
    await db.exec('savepoint failed_batch');
    await assert.rejects(db.exec('select ht_crypto_audit_legacy_evidence(500)'),/synthetic failure/);
    await db.exec('rollback to savepoint failed_batch');
    assert.equal((await query('select count(*)::int as n from ht_crypto_legacy_audit_queue'))[0].n,1);
    assert.equal((await query("select count(*)::int as n from ht_crypto_legacy_source_fingerprints where source_table='ht_crypto_discovery_observations'"))[0].n,0);
  } finally {await db.exec('rollback');}
});
test('read-only snapshot proves archive integrity, while empty CoinAPI evidence stays empty',async()=>{
  const s=await snapshot();
  assert.equal(s.version,'crypto-evidence-health-v1');assert.equal(s.publication,null);assert.equal(s.ledger.saved_books,0);
  assert.ok(s.archive.every(a=>a.guards_enabled && a.deletion_protected && a.missing_audits===0 && a.evidence_mismatches===0));
  assert.ok(s.archive.every(a=>!a.evaluation_allowed));
});
async function withPublishedEpisode(run) {
  await db.exec('begin');
  try {
    const base=Date.now()-7_200_000, at=s=>new Date(base+s*1000).toISOString();
    const mid='COINBASE_SPOT_TEST_USD', identity={provider:'coinapi',marketId:mid,base:'TEST',quote:'USD'};
    async function publish(seconds, bid, selected) {
      const id=randomUUID(), decisionAt=at(seconds);
      const book={symbolId:mid,bid,ask:bid+.01,bidSize:1000,askSize:1000,asOf:decisionAt};
      const frame={version:'coinapi-vercel-pilot-v1',dataContractVersion:'coinapi-research-data-v2',provider:'coinapi',decisionAt,
        selectedMarkets:selected?[mid]:[],quotes:[{marketId:mid,book,failures:[]}],
        evidence:[{identity,book,trade:{price:bid,asOf:decisionAt}}],research:{decisions:[{identity,policyVersion:'test-policy'}]}};
      await db.query("insert into public.ht_coinapi_pilot_cycles(id,minute_at,status) values($1,$2,'running')",[id,decisionAt]);
      await db.query("update public.ht_coinapi_pilot_cycles set status='complete',frame=$2,evidence_sha256=$3,completed_at=now() where id=$1",[id,JSON.stringify(frame),'a'.repeat(64)]);
      return id;
    }
    const first=await publish(0,10,true);
    const last=await publish(300,12,false);
    await db.exec('select public.ht_coinapi_research_maintenance()');
    await db.query("update public.ht_coinapi_pilot_control set latest_cycle_id=$1 where id='global'",[last]);
    await db.query("insert into public.ht_coinapi_pilot_requests(id,cycle_id,path,settled_at,reported_credits,http_status) values($1,$2,'/v1/quotes/current',now(),1,200)",[randomUUID(),last]);
    await run({first,last,mid,at});
  } finally { await db.exec('rollback'); }
}
test('atomic snapshot links the publication, its paid receipts and exact-market outcome math',async()=>withPublishedEpisode(async({last})=>{
  const s=await snapshot();
  assert.equal(s.publication.id,last);assert.equal(s.control.latest_cycle_id,last);
  assert.equal(s.receipts.publicationRequests,1);assert.equal(s.receipts.publicationCredits,1);assert.equal(s.receipts.publicationErrors,0);
  assert.equal(s.ledgerIntegrity.verifiedEntries,1);assert.equal(s.ledgerIntegrity.invalidOutcomes,0);
  assert.equal(s.ledgerIntegrity.missingHorizons,0);assert.equal(s.ledgerIntegrity.maturedHorizons,4);
  assert.equal(s.ledger.observed_horizons,1);assert.equal(s.ledger.unavailable_horizons,3);assert.equal(s.ledger.overdue_horizons,0);
}));
test('missing horizons, wrong outcome math and unknown paid request costs are exposed',async()=>withPublishedEpisode(async()=>{
  await db.exec('delete from public.ht_crypto_research_outcomes where horizon_seconds=3600');
  await db.exec("update public.ht_crypto_research_outcomes set gross_quote_return_percent=999 where status='observed'");
  await db.exec('update public.ht_coinapi_pilot_requests set reported_credits=null');
  const s=await snapshot();
  assert.equal(s.ledgerIntegrity.missingHorizons,1);assert.equal(s.ledgerIntegrity.invalidOutcomes,1);
  assert.equal(s.receipts.unknownCosts,1);assert.equal(s.receipts.publicationErrors,1);
}));
test('a horizon sourced from another market or wrong provider time is invalid',async()=>withPublishedEpisode(async({last})=>{
  await db.query("update public.ht_crypto_research_books set market_id='KRAKEN_SPOT_TEST_USD' where cycle_id=$1",[last]);
  assert.equal((await snapshot()).ledgerIntegrity.invalidOutcomes,1);
  await db.query("update public.ht_crypto_research_books set market_id='COINBASE_SPOT_TEST_USD',provider_at=provider_at-interval '1 minute' where cycle_id=$1",[last]);
  assert.equal((await snapshot()).ledgerIntegrity.invalidOutcomes,1);
}));
test('disabled guards and missing audit rows remain detectable',async()=>{
  await db.exec('alter table public.ht_crypto_prox_observations disable trigger ht_crypto_observation_only');
  assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').guards_enabled,false);
  await db.exec('alter table public.ht_crypto_prox_observations enable trigger ht_crypto_observation_only');
  await db.exec("delete from public.ht_crypto_legacy_evidence_audits where source_table='ht_crypto_prox_observations'");
  assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').missing_audits,1);
  await db.exec('select public.ht_coinapi_research_maintenance()');
  if(queryRepair) {
    // Live maintenance cannot absorb a large archive batch or roll back its work.
    assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').missing_audits,1);
    await db.exec('select public.ht_crypto_audit_legacy_evidence()');
  }
  assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').missing_audits,0);
});
test('unexpected provider evidence requires review, not automatic archival closure',async()=>{
  // Owner-only fixture simulates evidence not emitted by the documented writer.
  await db.exec('alter table public.ht_crypto_prox_observations disable trigger ht_crypto_observation_only');
  await db.exec(`update public.ht_crypto_prox_observations set decision_snapshot='{"providerAt":"2026-09-02T12:00:00Z"}'`);
  assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').evidence_mismatches,1);
  await db.exec("delete from public.ht_crypto_legacy_evidence_audits where source_table='ht_crypto_prox_observations'; select public.ht_crypto_audit_legacy_evidence();");
  assert.equal((await snapshot()).archive.find(a=>a.source_table==='ht_crypto_prox_observations').reviews_required,1);
  await db.exec('alter table public.ht_crypto_prox_observations enable trigger ht_crypto_observation_only');
});
test('application cannot rewrite/delete audits; anonymous callers cannot inspect saved evidence',async()=>{
  await db.exec('set role anon');
  try {await assert.rejects(db.exec('select public.ht_crypto_evidence_health_snapshot()'));await assert.rejects(db.exec('select public.ht_crypto_audit_legacy_evidence()'));} finally {await db.exec('reset role');}
  await db.exec('set role service_role');
  try {
    assert.equal((await snapshot()).archive.length,2);
    await assert.rejects(db.exec('delete from public.ht_crypto_legacy_evidence_audits'));
    await assert.rejects(db.exec("update public.ht_crypto_legacy_evidence_audits set status='unverifiable_from_saved_evidence'"));
    await assert.rejects(db.exec('select public.ht_crypto_audit_legacy_evidence(20001)'));
  } finally {await db.exec('reset role');}
});
