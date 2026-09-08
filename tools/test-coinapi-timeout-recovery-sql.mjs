// Isolated PostgreSQL only: no credentials, production mutations or provider calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
if(!isAbsolute(process.argv[2]??'')) throw Error('Supply isolated PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.argv[2]));
const db=new PGlite(),path='/v1/ohlcv/COINBASE_SPOT_STX_USD/latest?period_id=1MIN&limit=65';
const read=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const migration=await read('0041_coinapi_bounded_timeout_recovery.sql');
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const rpc=(name)=>value(`select public.${name}() as v`);
const recover=()=>rpc('ht_coinapi_recover_bounded_timeouts');
const accounting=()=>rpc('ht_coinapi_pilot_accounting_snapshot');
let receipt,cycle;
test.before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
  for(const name of ['0011_crypto_prox_observation_history.sql','0012_crypto_multivenue_discovery.sql',
    '0035_coinapi_vercel_pilot.sql','0036_crypto_research_evidence_integrity.sql','0037_crypto_legacy_observation_only.sql',
    '0038_crypto_audit_and_health.sql','0039_crypto_audit_query_repair.sql','0040_manual_crypto_paper.sql']) await db.exec(await read(name));
  await db.exec(migration);
  if(process.argv[3]==='0042') await db.exec(await read('0042_crypto_database_reliability.sql'));
});
test.after(()=>db.close());
test.beforeEach(async()=>{
  await db.exec(`delete from ht_coinapi_pilot_cost_holds;delete from ht_coinapi_pilot_requests;delete from ht_coinapi_pilot_cycles;
    update ht_coinapi_pilot_control set enabled=true,blocked_reason='unknown_provider_cost',lease_id=null,lease_until=null,
      latest_cycle_id=null,daily_reserved=142,lifetime_reserved=142,daily_credit_limit=300,lifetime_credit_limit=900;`);
  receipt=randomUUID();cycle=randomUUID();
  await db.query("insert into ht_coinapi_pilot_cycles(id,minute_at,status,error_code) values($1,now()-interval '5 minutes','failed','unknown_provider_cost')",[cycle]);
  await db.query(`insert into ht_coinapi_pilot_requests(id,cycle_id,path,reserved_at,settled_at,http_status)
    values($1,$2,$3,now()-interval '5 minutes',now()-interval '4 minutes',0)`,[receipt,cycle,path]);
});
test('recovery preserves the entire receipt, its null actual cost, failed cycle and full budget reservations',async()=>{
  const before=await value('select to_jsonb(r) as v from ht_coinapi_pilot_requests r');
  const result=await recover();assert.equal(result.recovered,true);assert.equal(result.providerRequests,0);
  assert.equal(result.reportedChargeStillUnknown,true);
  assert.deepEqual(await value('select to_jsonb(r) as v from ht_coinapi_pilot_requests r'),before);
  const control=await value('select to_jsonb(c) as v from ht_coinapi_pilot_control c');
  assert.equal(control.blocked_reason,null);assert.equal(control.daily_reserved,142);assert.equal(control.lifetime_reserved,142);
  assert.equal(control.daily_credit_limit,300);assert.equal(control.lifetime_credit_limit,900);
  assert.equal(await value('select status as v from ht_coinapi_pilot_cycles'),'failed');
  const a=await accounting();assert.equal(a.heldUnknownRequests,1);assert.equal(a.heldMaximumCredits,1);
  assert.equal(a.unboundedUnknownRequests,0);assert.equal(a.reservationCovered,true);
});
test('reruns and repeated recovery cannot refund funds, duplicate holds or fabricate success',async()=>{
  await recover();const hold=await value('select to_jsonb(h) as v from ht_coinapi_pilot_cost_holds h');
  await recover();await db.exec(migration);
  assert.deepEqual(await value('select to_jsonb(h) as v from ht_coinapi_pilot_cost_holds h'),hold);
  assert.equal(await value('select count(*)::int as v from ht_coinapi_pilot_requests'),1);
  assert.equal(Number(await value('select lifetime_reserved as v from ht_coinapi_pilot_control')),142);
});
for(const badPath of [path+'&limit=500',path.replace('65','101'),path.replace('65','0'),path.replace('1MIN','1SEC'),
  path.replace('COINBASE','UNKNOWN'),path.replace('_USD','_BTC'),path+'&unknown=x','/v1/orderbooks/current',path+'\n']) {
  test(`unbounded/unsupported request remains paused: ${JSON.stringify(badPath)}`,async()=>{
    await db.query('update ht_coinapi_pilot_requests set path=$1',[badPath]);
    assert.equal((await recover()).recovered,false);
    assert.equal((await accounting()).heldUnknownRequests,0);
  });
}
test('exact catalog and shared quote shapes also retain one full documented credit',async()=>{
  for(const p of ['/v1/symbols?filter_exchange_id=COINBASE,KRAKEN,CRYPTOCOM','/v1/quotes/current?filter_exchange_id=COINBASE,KRAKEN,CRYPTOCOM'])
    assert.equal(await value('select ht_coinapi_one_credit_path($1) as v',[p]),true);
});
for(const status of [401,403,429,500,200]) test(`HTTP ${status} cannot masquerade as a transport timeout`,async()=>{
  await db.query('update ht_coinapi_pilot_requests set http_status=$1',[status]);assert.equal((await recover()).recovered,false);
});
test('disabled collector, live lease, unsettled writes and active/complete cycles never recover',async()=>{
  for(const sql of ['update ht_coinapi_pilot_control set enabled=false',
    "update ht_coinapi_pilot_control set lease_until=now()+interval '1 minute'",
    'update ht_coinapi_pilot_requests set settled_at=null',
    "update ht_coinapi_pilot_cycles set status='running'",
    "update ht_coinapi_pilot_cycles set status='complete',frame='{}',evidence_sha256=repeat('a',64)"]) {
    await db.exec('begin');try {await db.exec(sql);assert.equal((await recover()).recovered,false,sql);} finally{await db.exec('rollback');}
  }
});
test('under-reserved counters, over-budget responses and unrelated blocks cannot be released',async()=>{
  for(const sql of ['update ht_coinapi_pilot_control set lifetime_reserved=0',
    'update ht_coinapi_pilot_control set daily_reserved=0',
    'update ht_coinapi_pilot_requests set reported_credits=2',
    "update ht_coinapi_pilot_control set blocked_reason='provider_access_blocked'"]) {
    await db.exec('begin');try{await db.exec(sql);assert.equal((await recover()).recovered,false,sql);} finally{await db.exec('rollback');}
  }
});
test('actual settlement cannot be rewritten to one credit after the hold',async()=>{
  await recover();const result=await value('select ht_coinapi_pilot_settle($1,1,200) as v',[receipt]);
  assert.equal(result.reason,'receipt_already_settled');
  assert.equal(await value('select reported_credits as v from ht_coinapi_pilot_requests'),null);
});
test('receipt tampering invalidates its hold and stays visible in atomic health',async()=>{
  await recover();await db.exec("update ht_coinapi_pilot_requests set path=path||'&tampered=true'");
  const a=await accounting();assert.equal(a.invalidHolds,1);assert.equal(a.unboundedUnknownRequests,1);
  assert.equal(await value('select ht_coinapi_request_hold_valid($1) as v',[receipt]),false);
});
test('health snapshot preserves raw unknown counts, archives and missing publication while adding provenance',async()=>{
  await recover();const h=await rpc('ht_crypto_evidence_health_snapshot');
  assert.equal(h.receipts.unknownCosts,1);assert.equal(h.publication,null);assert.equal(h.archive.length,2);
  assert.equal(h.accounting.heldUnknownRequests,1);assert.equal(h.accounting.receiptNotFabricated,true);
});
test('fresh successful collection can start after recovery but budget exhaustion still blocks',async()=>{
  await recover();await db.exec('begin');
  try{assert.equal((await value('select ht_coinapi_pilot_begin($1) as v',[randomUUID()])).allowed,true);}finally{await db.exec('rollback');}
  await db.exec('update ht_coinapi_pilot_control set daily_reserved=300');
  assert.equal((await value('select ht_coinapi_pilot_begin($1) as v',[randomUUID()])).reason,'credit_budget_reached');
});
test('no publication is invented when the collector is recovered',async()=>{
  await recover();const q=await value('select ht_crypto_paper_quote($1) as v',['COINBASE_SPOT_STX_USD']);
  assert.equal(q.ok,false);assert.equal(q.reason,'publication_unverified');
});
test('bounded old timeout → new verified quote → manual paper buy → sell reconciles without unpausing stale data',async()=>{
  await db.exec('begin');
  try {
    await recover();const market='COINBASE_SPOT_STX_USD',user=randomUUID();let current;
    await db.query('insert into auth.users values($1)',[user]);
    await value('select ht_crypto_paper_open($1) as v',[user]);
    async function publish(offset,bid=10) {
      const at=await value('select clock_timestamp()::text as v');current=randomUUID();
      const book={symbolId:market,bid,ask:bid+.01,bidSize:1000,askSize:1000,asOf:at};
      const trade={symbolId:market,price:bid,asOf:at};
      const frame={provider:'coinapi',dataContractVersion:'coinapi-research-data-v2',authority:'research_only',
        executionAuthorized:false,decisionAt:at,quotes:[{marketId:market,book,trade,failures:[]}],
        coverage:[{marketId:market,status:'quote_only_not_deep_scored'}]};
      await db.query(`insert into ht_coinapi_pilot_cycles(id,minute_at,status,frame,evidence_sha256)
        values($1,'2001-01-01'::timestamptz+$2*interval '1 minute','complete',$3,repeat('a',64))`,[current,offset,frame]);
      await db.query('update ht_coinapi_pilot_control set latest_cycle_id=$1',[current]);
      await db.query(`insert into ht_coinapi_pilot_requests(id,cycle_id,path,settled_at,reported_credits,http_status)
        values($1,$2,'/v1/quotes/current?filter_exchange_id=COINBASE,KRAKEN,CRYPTOCOM',clock_timestamp(),1,200)`,[randomUUID(),current]);
    }
    async function order(side,limit) {
      return value('select ht_crypto_paper_submit($1,$2,$3,$4,1,$5,$6) as v',[user,randomUUID(),market,side,limit,current]);
    }
    await publish(1);const buy=await order('buy',11);
    assert.equal((await value('select ht_crypto_paper_match($1) as v',[buy.orderId])).reason,'fresh_post_order_quote_required');
    await publish(2);assert.equal((await value('select ht_crypto_paper_match($1) as v',[buy.orderId])).status,'filled');
    const sell=await order('sell',9);await publish(3,12);
    assert.equal((await value('select ht_crypto_paper_match($1) as v',[sell.orderId])).status,'filled');
    const dashboard=await value('select ht_crypto_paper_dashboard($1) as v',[user]);
    assert.equal(dashboard.positions.length,0);assert.equal(dashboard.fills.length,2);
    const health=await rpc('ht_crypto_paper_health');assert.equal(health.accountMismatches,0);assert.equal(health.positionMismatches,0);
    assert.equal(await value('select reported_credits as v from ht_coinapi_pilot_requests where id=$1',[receipt]),null);
    assert.equal((await accounting()).heldUnknownRequests,1);
    // Historical receipt is allowed, but a newly stale frame is still refused.
    await db.query(`update ht_coinapi_pilot_cycles set frame=jsonb_set(frame,'{decisionAt}','"2001-01-01T00:00:00Z"') where id=$1`,[current]);
    assert.equal((await value('select ht_crypto_paper_quote($1) as v',[market])).reason,'collection_stale');
  } finally {await db.exec('rollback');}
});
test('only service-role recovery is allowed; application cannot rewrite holds',async()=>{
  for(const role of ['anon','authenticated']) {
    assert.equal(await value(`select has_function_privilege('${role}','ht_coinapi_recover_bounded_timeouts()','EXECUTE') as v`),false);
    assert.equal(await value(`select has_table_privilege('${role}','ht_coinapi_pilot_cost_holds','SELECT') as v`),false);
  }
  assert.equal(await value("select has_table_privilege('service_role','ht_coinapi_pilot_cost_holds','UPDATE') as v"),false);
  await db.exec('set role service_role');
  try{assert.equal((await recover()).recovered,true);assert.equal((await rpc('ht_crypto_evidence_health_snapshot')).accounting.heldUnknownRequests,1);}finally{await db.exec('reset role');}
});
