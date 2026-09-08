// Isolated PostgreSQL benchmark: synthetic archive, quotes and virtual orders only.
// No network, credentials, provider spending or production database access.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
if(!isAbsolute(process.argv[2]??'')) throw Error('Absolute isolated PGlite module required');
const {PGlite}=await import(pathToFileURL(process.argv[2]));
const db=new PGlite();
const count=Number(process.argv[3]??200000);
const projection=process.argv[4]==='0044';
const queued=process.argv[4]==='0043'||projection;
assert.ok(Number.isSafeInteger(count)&&count>=100&&count<=200000);
const read=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const readQueue=queued?await read('0043_crypto_archive_queue.sql'):'';
const readProjection=projection?await read('0044_crypto_health_projection.sql'):'';
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const metrics={syntheticRows:count,providerRequests:0};
async function measure(label,fn){const start=performance.now();const result=await fn();metrics[label]=Math.round(performance.now()-start);console.log(JSON.stringify({label,ms:metrics[label]}));return result;}
try {
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
  for(const name of ['0011_crypto_prox_observation_history.sql','0012_crypto_multivenue_discovery.sql','0035_coinapi_vercel_pilot.sql']) await db.exec(await read(name));
  await measure('seedMs',()=>db.exec(`insert into ht_crypto_prox_observations(product_id,symbol,observed_at,observation_minute,role,rank,entry_price,canonical_score,methodology_version,target_15m_at,target_1h_at,target_4h_at,target_24h_at,prox_packet)
    select 'TEST-USD','TEST',now(),now()+n*interval '1 minute','radar',1,10,60,'legacy',now(),now(),now(),now(),jsonb_build_object('details',repeat(md5(n::text),128)) from generate_series(1,${count}) n;`));
  for(const name of ['0036_crypto_research_evidence_integrity.sql','0037_crypto_legacy_observation_only.sql','0038_crypto_audit_and_health.sql','0039_crypto_audit_query_repair.sql','0040_manual_crypto_paper.sql','0041_coinapi_bounded_timeout_recovery.sql'])
    await db.exec((await read(name)).replace('select public.ht_crypto_audit_legacy_evidence(20000);',''));
  await db.exec('analyze ht_crypto_prox_observations');
  await measure('oldArchiveDrainMs',async()=>{while(Number(await scalar('select ht_crypto_audit_legacy_evidence(20000) as v'))>0){/* isolated only */}});
  await db.exec('analyze ht_crypto_legacy_evidence_audits');
  const before=await measure('oldHealthMs',()=>scalar('select ht_crypto_evidence_health_snapshot() as v'));
  assert.equal(before.archive[1].source_table,'ht_crypto_prox_observations');
  assert.equal(before.archive[1].audited_records,count);

  // Full production-sized universe: only two markets are selected for deep research.
  async function publish(offset,bid=100){
    const id=randomUUID(),at=await scalar('select clock_timestamp()::text as v');
    const quotes=Array.from({length:1675},(_,i)=>{const marketId=`COINBASE_SPOT_${i===0?'BTC':i===1?'ETH':'TEST'+i}_USD`;
      return {marketId,trade:{symbolId:marketId,price:bid,asOf:at},book:{symbolId:marketId,bid,ask:bid+.01,bidSize:1000,askSize:1000,asOf:at},failures:[]};});
    const frame={version:'coinapi-vercel-pilot-v1',dataContractVersion:'coinapi-research-data-v2',provider:'coinapi',authority:'research_only',
      executionAuthorized:false,publicRankingChanged:false,decisionAt:at,quotes,selectedMarkets:quotes.slice(0,2).map(q=>q.marketId),
      coverage:quotes.map(q=>({marketId:q.marketId,status:'quote_only_not_deep_scored'})),
      evidence:quotes.slice(0,2).map(q=>({identity:{provider:'coinapi',marketId:q.marketId,base:q.marketId.split('_')[2],quote:'USD'},book:q.book,trade:q.trade})),
      research:{decisions:quotes.slice(0,2).map(q=>({identity:{marketId:q.marketId},policyVersion:'test-only'}))}};
    await db.query("insert into ht_coinapi_pilot_cycles(id,minute_at,status) values($1,'2001-01-01'::timestamptz+$2*interval '1 minute','running')",[id,offset]);
    await db.query("update ht_coinapi_pilot_cycles set status='complete',frame=$2,evidence_sha256=repeat('a',64),completed_at=clock_timestamp() where id=$1",[id,frame]);
    await db.query('update ht_coinapi_pilot_control set latest_cycle_id=$1',[id]);
    await db.query("insert into ht_coinapi_pilot_requests(id,cycle_id,path,settled_at,reported_credits,http_status) values($1,$2,'/v1/quotes/current',clock_timestamp(),1,200)",[randomUUID(),id]);
    return id;
  }
  await db.exec('begin');
  await measure('oldPublicationMs',()=>publish(1));
  const oldBooks=await scalar('select count(*)::int as v from ht_crypto_research_books');
  await db.exec('rollback');

  await db.exec(await read('0042_crypto_database_reliability.sql'));
  if(queued) {
    await db.exec("set work_mem='64kB'");
    await measure('queueSeedMs',()=>db.exec(readQueue));
  }
  const pending=await scalar('select ht_crypto_evidence_health_snapshot() as v');
  assert.equal(pending.archive[1].evidence_mismatches,count,'existing audits are NOT trusted as source verification');
  await measure('newFingerprintDrainMs',async()=>{let maxMs=0,n;do{
    const at=performance.now();n=Number(await scalar(`select ht_crypto_audit_legacy_evidence(${queued?500:20000}) as v`));
    maxMs=Math.max(maxMs,performance.now()-at);
  }while(n>0);metrics.maxArchiveBatchMs=Math.round(maxMs);});
  await db.exec('analyze ht_crypto_legacy_source_fingerprints');
  const after=await measure('newHealthMs',()=>scalar('select ht_crypto_evidence_health_snapshot() as v'));
  assert.deepEqual(after.archive,before.archive,'same complete archive result and protections');
  if(projection) {
    await measure('projectionMigrationMs',()=>db.exec(readProjection));
    const projected=await measure('projectedHealthMs',()=>scalar('select ht_crypto_evidence_health_snapshot() as v'));
    assert.deepEqual(projected.archive,after.archive,'projection preserves every health count and original exclusion');
    const plan=await db.query('explain select * from ht_crypto_legacy_tracking_readiness');
    console.log(JSON.stringify({projectionPlan:plan.rows.map(r=>r['QUERY PLAN'])}));
  }
  await measure('newPublicationMs',()=>publish(2));
  assert.equal(await scalar('select count(*)::int as v from ht_crypto_research_books'),oldBooks);

  // Actual SQL order lifecycle with the large archive present, no manual fill edits.
  const user=randomUUID(),market='COINBASE_SPOT_BTC_USD';
  await db.query('insert into auth.users values($1)',[user]);
  await db.exec('update ht_coinapi_pilot_control set enabled=true,daily_reserved=10,lifetime_reserved=10');
  await scalar('select ht_crypto_paper_open($1) as v',[user]);
  async function order(side,limit){const cycle=await scalar('select latest_cycle_id as v from ht_coinapi_pilot_control');
    return scalar('select ht_crypto_paper_submit($1,$2,$3,$4,.1,$5,$6) as v',[user,randomUUID(),market,side,limit,cycle]);}
  const buy=await order('buy',101);
  assert.equal((await scalar('select ht_crypto_paper_match($1) as v',[buy.orderId])).reason,'fresh_post_order_quote_required');
  await measure('nextPublicationMs',()=>publish(3));
  assert.equal((await scalar('select ht_crypto_paper_match($1) as v',[buy.orderId])).status,'filled');
  const sell=await order('sell',99);await publish(4,102);
  assert.equal((await scalar('select ht_crypto_paper_match($1) as v',[sell.orderId])).status,'filled');
  const account=await scalar('select ht_crypto_paper_dashboard($1) as v',[user]);
  assert.equal(account.positions.length,0);assert.equal(account.fills.length,2);
  const paper=await measure('paperHealthMs',()=>scalar('select ht_crypto_paper_health() as v'));
  for(const key of ['accountMismatches','positionMismatches','orderMismatches','auditMismatches']) assert.equal(paper[key],0);
  // Timing gates compare the same isolated hardware; production still needs verification.
  assert.ok(metrics.newHealthMs<metrics.oldHealthMs/2,'health must improve materially without weaker checks');
  assert.ok(metrics.newPublicationMs<metrics.oldPublicationMs,'publication must remove repeated snapshot work');
  console.log(JSON.stringify({verified:true,...metrics,paperLifecycle:'buy-sell-closed',productionVerified:false},null,2));
}finally{await db.close();}
