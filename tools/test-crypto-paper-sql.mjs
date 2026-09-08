// Isolated database only. No production credentials, provider usage or orders.
// node tools/test-crypto-paper-sql.mjs /absolute/path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
if(!isAbsolute(process.argv[2]??'')) throw Error('Supply the isolated PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.argv[2]));
const db=new PGlite();
const migration=await readFile(new URL('../supabase/migrations/0040_manual_crypto_paper.sql',import.meta.url),'utf8');
const reliability=process.argv[3]==='0042';
const recovery=process.argv[3]==='0041'||reliability;
const recoveryMigration=recovery?await readFile(new URL('../supabase/migrations/0041_coinapi_bounded_timeout_recovery.sql',import.meta.url),'utf8'):'';
const user=randomUUID(),other=randomUUID(),market='COINBASE_SPOT_BTC_USD';
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const rpc=(fn,args=[])=>scalar(`select public.ht_crypto_paper_${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args);
let sequence=0,cycle;
async function publication(options={}) {
  // Every fixture is an isolated synthetic publication, never a real provider claim.
  const timestamp=await scalar('select clock_timestamp()::text as v');
  const q={marketId:market,trade:{symbolId:market,price:100,asOf:timestamp},
    book:{symbolId:market,bid:99,ask:100,bidSize:100,askSize:100,asOf:timestamp},failures:[]};
  Object.assign(q.book,options.book);Object.assign(q.trade,options.trade);
  if(options.failures) q.failures=options.failures;
  const frame={provider:'coinapi',dataContractVersion:'coinapi-research-data-v2',authority:'research_only',
    executionAuthorized:false,decisionAt:timestamp,quotes:[q],coverage:[{marketId:market,status:'quote_only_not_deep_scored'}],...options.frame};
  const id=randomUUID();
  await db.query(`insert into ht_coinapi_pilot_cycles(id,minute_at,status,frame,evidence_sha256)
    values($1,'2001-01-01'::timestamptz+$2*interval '1 minute','complete',$3,$4)`,[id,sequence++,JSON.stringify(frame),'a'.repeat(64)]);
  await db.query('update ht_coinapi_pilot_control set latest_cycle_id=$1',[id]);
  cycle=id;return id;
}
const submit=(side='buy',qty='1',limit='101',id=randomUUID(),who=user)=>rpc('submit',[who,id,market,side,qty,limit,cycle]);
const match=(order)=>rpc('match',[order.orderId]);
const near=(a,b)=>assert.ok(Math.abs(Number(a)-b)<1e-8,`${a} != ${b}`);
test.before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);`);
  await db.exec(await readFile(new URL('../supabase/migrations/0035_coinapi_vercel_pilot.sql',import.meta.url),'utf8'));
  if(reliability) for(const f of ['0011_crypto_prox_observation_history.sql','0012_crypto_multivenue_discovery.sql',
    '0036_crypto_research_evidence_integrity.sql','0037_crypto_legacy_observation_only.sql','0038_crypto_audit_and_health.sql','0039_crypto_audit_query_repair.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  await db.exec(migration);
  if(recovery) {
    // Wrapper health is tested with the real full schema in the dedicated recovery suite.
    if(!reliability) await db.exec("create function ht_crypto_evidence_health_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;");
    await db.exec(recoveryMigration);
  }
  if(reliability) await db.exec(await readFile(new URL('../supabase/migrations/0042_crypto_database_reliability.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[user,other]);
});
test.after(()=>db.close());
test.beforeEach(async()=>{
  await db.exec(`truncate ht_crypto_paper_events,ht_crypto_paper_fills,ht_crypto_paper_orders,ht_crypto_paper_positions,ht_crypto_paper_accounts;
    delete from ht_coinapi_pilot_requests;delete from ht_coinapi_pilot_cycles;
    update ht_coinapi_pilot_control set enabled=true,blocked_reason=null,latest_cycle_id=null;
    update ht_crypto_paper_control set enabled=true;`);
  await rpc('open',[user]);await publication();
});
test('buy → partial sell → close reconciles cash, cost basis, net P&L and immutable audit',async()=>{
  const preview=await rpc('preview',[user,market,'buy','2','101']);near(preview.total,203.212);
  const buy=await submit('buy','2');assert.equal((await match(buy)).reason,'fresh_post_order_quote_required');
  await publication();assert.equal((await match(buy)).status,'filled');
  let d=await rpc('dashboard',[user]);near(d.account.cash,100000-2*100.1*1.006);assert.equal(d.positions[0].quantity,'2.000000000000');
  const sell=await submit('sell','.5','100');await publication({book:{bid:110,ask:111}});
  assert.equal((await match(sell)).status,'filled');
  d=await rpc('dashboard',[user]);near(d.positions[0].quantity,1.5);
  const close=await submit('sell',d.positions[0].available_quantity,'100');await publication({book:{bid:110,ask:111}});
  assert.equal((await match(close)).status,'filled');d=await rpc('dashboard',[user]);
  assert.equal(d.positions.length,0);near(d.account.realized_pnl,2*110*.999*.994-2*100.1*1.006);
  near(d.account.cash,100000+Number(d.account.realized_pnl));assert.equal(d.fills.length,3);
  const health=await rpc('health');assert.equal(health.accountMismatches,0);assert.equal(health.positionMismatches,0);
  assert.equal(await scalar("select count(*)::int as v from ht_crypto_paper_events where event_type='fill'"),3);
  assert.equal(await scalar("select count(*)::int as v from ht_crypto_paper_fills where evidence->>'policyVersion'='crypto-manual-paper-v1'"),3);
});
test('same request is idempotent after feed pause; changed payload is rejected',async()=>{
  const id=randomUUID(),a=await submit('buy','1','101',id);
  await db.exec("update ht_coinapi_pilot_control set blocked_reason='unknown_provider_cost'");
  const b=await submit('buy','1','101',id);assert.equal(a.orderId,b.orderId);assert.equal(b.duplicate,true);
  await assert.rejects(submit('buy','2','101',id),/Idempotency key/);
  assert.equal((await rpc('dashboard',[user])).orders.length,1);
});
test('liquidity is partial, globally consumed, never reused by a second order or retry',async()=>{
  const a=await submit('buy','2'),b=await submit('buy','2');await publication({book:{askSize:.75}});
  assert.equal((await match(a)).status,'partially_filled');assert.equal((await match(a)).reason,'quote_already_used');
  assert.equal((await match(b)).reason,'displayed_liquidity_consumed');
  await publication({book:{askSize:2}});assert.equal((await match(a)).status,'filled');
  assert.equal((await match(b)).status,'partially_filled');
  const d=await rpc('dashboard',[user]);near(d.positions[0].quantity,2.75);
  assert.equal((await rpc('health')).positionMismatches,0);
});
test('pending buys reserve fees and cash; competing submissions cannot overspend',async()=>{
  const attempts=await Promise.allSettled([submit('buy','500','100'),submit('buy','500','100')]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  near((await rpc('dashboard',[user])).reservedCash,50300);
  await assert.rejects(submit('buy','1000','101'),/Insufficient/);
});
test('pending sells reserve units; no shorts or overselling',async()=>{
  await assert.rejects(submit('sell','1','90'),/exceeds/);
  const a=await submit('buy','1');await publication();await match(a);
  await submit('sell','.7','90');await assert.rejects(submit('sell','.4','90'),/exceeds/);
  near((await rpc('dashboard',[user])).positions[0].available_quantity,.3);
  await assert.rejects(submit('short','1','90'),/Invalid/);
});
test('partial cancel releases remaining funds but does not undo filled units; owner only',async()=>{
  const a=await submit('buy','2');await publication({book:{askSize:.5}});await match(a);
  await assert.rejects(rpc('cancel',[other,a.orderId]),/not found/);
  await rpc('cancel',[user,a.orderId]);await rpc('cancel',[user,a.orderId]);
  const d=await rpc('dashboard',[user]);near(d.reservedCash,0);near(d.positions[0].quantity,.5);
  assert.equal((await match(a)).status,'unchanged');
});
test('kill switch blocks new orders and fills but cancellations/expirations remain available',async()=>{
  const a=await submit(),b=await submit();await publication();
  await db.exec('update ht_crypto_paper_control set enabled=false');
  await assert.rejects(submit(),/paused/);assert.equal((await match(a)).reason,'paper_paused');
  await rpc('cancel',[user,a.orderId]);
  await db.query("update ht_crypto_paper_orders set expires_at=clock_timestamp()-interval '1 second' where id=$1",[b.orderId]);
  assert.equal((await match(b)).status,'expired');near((await rpc('dashboard',[user])).reservedCash,0);
});
test('limit protection never fabricates a fill at a price the book did not offer',async()=>{
  const a=await submit('buy','1','99');await publication();assert.equal((await match(a)).reason,'limit_not_reached');
  assert.equal((await rpc('dashboard',[user])).fills.length,0);
});
for(const [name,options] of Object.entries({
  staleBook:{book:{asOf:'2001-01-01T00:00:00Z'}},futureBook:{book:{asOf:'2999-01-01T00:00:00Z'}},
  staleTrade:{trade:{asOf:'2001-01-01T00:00:00Z'}},futureTrade:{trade:{asOf:'2999-01-01T00:00:00Z'}},
  missingTime:{book:{asOf:null}},wrongPair:{book:{symbolId:'KRAKEN_SPOT_BTC_USD'}},
  crossedBook:{book:{bid:102,ask:100}},zeroPrice:{trade:{price:0}},missingLiquidity:{book:{askSize:null}},
  invalidPrint:{failures:['bad_print']},missingCoverage:{frame:{coverage:[]}},
  excludedAsset:{frame:{coverage:[{marketId:market,status:'asset_policy_excluded'}]}},
  staleCollection:{frame:{decisionAt:'2001-01-01T00:00:00Z'}},
})) test(`${name}: no fill and no loss of reserved cash`,async()=>{
  const a=await submit();await publication(options);const result=await match(a);
  assert.equal(result.status,'waiting');const d=await rpc('dashboard',[user]);near(d.account.cash,100000);assert.equal(d.fills.length,0);
});
test('fresh but misaligned book/trade timestamps cannot fill',async()=>{
  const a=await submit();await publication({trade:{asOf:new Date(Date.now()-20_000).toISOString()}});
  assert.equal((await match(a)).reason,'fresh_post_order_quote_required');
});
test('unknown accounting receipt blocks even if control was incorrectly unpaused',async()=>{
  const a=await submit();await publication();
  await db.query("insert into ht_coinapi_pilot_requests(id,cycle_id,path,settled_at,http_status) values($1,$2,'fixture',now(),0)",[randomUUID(),cycle]);
  assert.equal((await match(a)).reason,'publication_unverified');
  await assert.rejects(submit(),/unavailable/);
});
test('decimal dollar sizing includes fees; selling all retains 12-decimal dust precision',async()=>{
  const p=await rpc('preview_budget',[user,market,'25','101']);assert.ok(Number(p.total)<=25);
  const a=await submit('buy',p.quantity,'101');await publication();await match(a);
  const units=(await rpc('dashboard',[user])).positions[0].available_quantity;
  const b=await submit('sell',units,'90');await publication();await match(b);
  assert.equal((await rpc('dashboard',[user])).positions.length,0);
  assert.equal((await rpc('health')).positionMismatches,0);
});
test('migration rerun and account reopen never reset money or collection budget',async()=>{
  const a=await submit();await publication();await match(a);const before=await rpc('dashboard',[user]);
  await db.exec('update ht_coinapi_pilot_control set daily_reserved=142,lifetime_reserved=142;update ht_crypto_paper_control set enabled=false;');
  await db.exec(migration);await rpc('open',[user]);
  if(recovery) await db.exec(recoveryMigration);
  near((await rpc('dashboard',[user])).account.cash,Number(before.account.cash));
  assert.equal((await rpc('dashboard',[user])).enabled,false);
  assert.equal(await scalar('select lifetime_reserved::int as v from ht_coinapi_pilot_control'),142);
});
test('anonymous/authenticated roles cannot read other portfolios or execute ledger functions',async()=>{
  for(const role of ['anon','authenticated']) {
    assert.equal(await scalar(`select has_table_privilege('${role}','ht_crypto_paper_accounts','SELECT') as v`),false);
    assert.equal(await scalar(`select has_function_privilege('${role}','ht_crypto_paper_open(uuid)','EXECUTE') as v`),false);
  }
  assert.equal(await scalar("select has_table_privilege('service_role','ht_crypto_paper_accounts','UPDATE') as v"),false);
  assert.equal(await scalar("select has_function_privilege('service_role','ht_crypto_paper_submit(uuid,uuid,text,text,numeric,numeric,uuid)','EXECUTE') as v"),true);
  assert.equal((await rpc('dashboard',[other])).account,null);assert.deepEqual((await rpc('dashboard',[other])).orders,[]);
});
test('health flags account tampering and overdue order handling',async()=>{
  const a=await submit();await db.exec('update ht_crypto_paper_accounts set cash=cash+1');
  await db.query("update ht_crypto_paper_orders set expires_at=clock_timestamp()-interval '3 minutes' where id=$1",[a.orderId]);
  const h=await rpc('health');assert.equal(h.accountMismatches,1);assert.equal(h.overdueOrders,1);
});
test('existing owner-confirmed account deletion cascades only that user’s new crypto records',async()=>{
  const disposable=randomUUID();await db.query('insert into auth.users values($1)',[disposable]);
  await rpc('open',[disposable]);const a=await submit('buy','1','101',randomUUID(),disposable);
  await publication();await match(a);await db.query('delete from auth.users where id=$1',[disposable]);
  assert.equal((await rpc('dashboard',[disposable])).account,null);
  assert.equal(await scalar('select count(*)::int as v from ht_crypto_paper_fills where user_id=$1',[disposable]),0);
  assert.equal(await scalar('select count(*)::int as v from ht_crypto_paper_events where user_id=$1',[disposable]),0);
  assert.ok((await rpc('dashboard',[user])).account);
});
