// Real server module, mocked storage/read publication. No external calls allowed.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import * as contracts from '../lib/crypto/paper-contracts.ts';
const code=ts.transpileModule(await readFile(new URL('../lib/crypto/paper-server.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function harness(options={}){
  const calls=[];
  const d={enabled:true,account:{cash:900,starting_cash:1000,realized_pnl:0},reservedCash:100,
    positions:[{market_id:'COINBASE_SPOT_TEST_USD',quantity:'2',available_quantity:'2',cost_basis:100}],orders:[],fills:[]};
  const db={rpc:async(name,args)=>{calls.push({name,args});return options.error?{data:null,error:options.error}:
    {data:name==='ht_crypto_paper_dashboard'?d:{ok:true,fillId:'fixture-fill'},error:null};},from:(table)=>{
    assert.equal(table,'ht_crypto_paper_orders');calls.push({name:'orders'});
    const q={select:()=>q,in:(_col,values)=>{assert.deepEqual(Array.from(values),['open','partially_filled']);return q;},
      order:()=>q,limit:()=>Promise.resolve({data:options.orders??[],error:null})};return q;
  }};
  const deps={'./paper-contracts':contracts,'./coinapi-pilot-server':{coinApiPilotService:()=>db,readCoinApiPilot:async()=>{
    calls.push({name:'saved-feed'});return {status:options.stale?'paused':'collecting',budget:{blocked_reason:null},publicationId:'same-cycle',
      publication:{markets:options.missing?[]:[{marketId:'COINBASE_SPOT_TEST_USD',price:55,priceAsOf:'2026-09-03T03:00:00Z',priceStatus:'current'}]}};}}};
  const exports={};vm.runInNewContext(code,{exports,Date,Map,Math,require:n=>{assert.ok(n in deps,`Forbidden provider/broker dependency ${n}`);return deps[n];},
    fetch:()=>{throw Error('Network forbidden');}});return {exports,calls};
}
test('portfolio marks and chart feed share one saved publication without any provider call',async()=>{
  const h=harness(),d=await h.exports.readCryptoPaper('owner');
  assert.equal(d.buyingPower,800);assert.equal(d.equity,1010);assert.equal(d.positions[0].unrealizedPnl,10);
  assert.equal(d.positions[0].currentPrice,d.feed.publication.markets[0].price);assert.equal(d.realExecution,false);assert.equal(d.agentAutopilot,false);
  assert.equal(h.calls.filter(c=>c.name==='saved-feed').length,1);
});
test('missing marks remain missing; paused feed never produces a current label',async()=>{
  const missing=await harness({missing:true}).exports.readCryptoPaper('owner');assert.equal(missing.equity,null);assert.equal(missing.positions[0].marketValue,null);
  const stale=await harness({stale:true}).exports.readCryptoPaper('owner');assert.equal(stale.marksCurrent,false);
});
test('submit only records user intent; matcher only processes existing paper order ids',async()=>{
  const h=harness({orders:[{id:'existing-1'},{id:'existing-2'}]});
  await h.exports.submitCryptoPaper('owner',{marketId:'EXACT',side:'buy',quantity:'1',limitPrice:'2'},'client','preview');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'ht_crypto_paper_submit');
  const result=await h.exports.matchCryptoPaperOrders();assert.equal(result.processed,2);assert.equal(result.providerRequests,0);
  assert.equal(h.calls.filter(c=>c.name==='ht_crypto_paper_match').length,2);
});
test('storage failures preserve migration/actionable messages, never raw SQL details',async()=>{
  await assert.rejects(harness({error:{code:'42883',message:'secret'}}).exports.openCryptoPaper('owner'),/migration 0040/);
  await assert.rejects(harness({error:{code:'P0001',message:'Insufficient crypto paper buying power'}}).exports.openCryptoPaper('owner'),/Insufficient/);
  await assert.rejects(harness({error:{code:'P0001',message:'secret SQL detail'}}).exports.openCryptoPaper('owner'),error=>!error.message.includes('secret'));
});
