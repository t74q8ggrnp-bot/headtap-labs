// Execute the changed sections of the actual health route with database doubles.
// No credentials, provider calls, SQL writes, or production access.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {legacyCryptoOutcomeQuarantine} from '../lib/crypto/outcome-integrity.ts';
import {isObservationOnlyRow} from '../lib/crypto/evidence-health.ts';
import {assessCryptoPaperHealth} from '../lib/crypto/paper-health.ts';

const source=await readFile(new URL('../app/api/system-health/route.ts',import.meta.url),'utf8');
function section(start,end) {
  assert.ok(source.includes(start) && source.includes(end),'Health route changed: update test extraction');
  return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
}
const body=section('  const cryptoConfiguration =','  // Home, Crypto, and mobile')+
  section('  // The multi-venue lane','  // HT Agent is an isolated paper-only consumer.')+
  section('  const hardFailures =','\n}');
const compiled=ts.transpileModule(`export async function run(){const checks=[];${body}}`,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;

async function run(change=()=>{},options={}) {
  const now=new Date().toISOString();
  const unscheduled={outcome_tracking_status:'not_scheduled',target_15m_at:null,target_1h_at:null,target_4h_at:null,target_24h_at:null};
  const storage={
    ht_crypto_prox_collection_runs:{observed_at:now,observation_minute:now,expected_observation_count:1,persisted_observation_count:1,complete:true,
      observed_products:[{productId:'TEST-USD',symbol:'TEST',role:'radar',rank:1}],
      feed_diagnostics:{evaluatedProducts:1,providerFailures:0,proxEvaluatedProducts:1,proxAvailableProducts:1,proxProviderFailures:0}},
    ht_crypto_prox_observations:[{product_id:'TEST-USD',symbol:'TEST',role:'radar',rank:1,prox_state:'expanding',
      prox_packet:{mode:'bounded_authority',packetVersion:'crypto-prox-v2',state:'expanding',fresh:true},...unscheduled}],
    ht_crypto_discovery_runs:{observed_at:now,observation_minute:now,expected_candidate_count:1,persisted_candidate_count:1,complete:true,
      observed_assets:[{assetId:'crypto:coinbase:TEST',symbol:'TEST',rank:1}],
      source_diagnostics:{configuredVenues:3,healthyVenues:3,supportedPairs:1,observedAssets:1,candidateAssets:1,providerFailures:0,attentionSourceHealthy:true}},
    ht_crypto_discovery_observations:[{asset_id:'crypto:coinbase:TEST',symbol:'TEST',rank:1,
      discovery_packet:{assetId:'crypto:coinbase:TEST',rank:1},...unscheduled}],
  };
  change(storage);
  let reads=0;
  const supabase={rpc:async(name)=>name==='ht_crypto_paper_health'?{data:{schemaReady:true,policyVersion:'crypto-manual-paper-v1',manualPaperEnabled:true,
    realExecution:false,agentAutopilot:false,accounts:0,fills:0,openOrders:0,overdueOrders:0,accountMismatches:0,positionMismatches:0,orderMismatches:0,auditMismatches:0},error:null}
    :({data:options.missingAudit?null:{proof:true},error:options.missingAudit?{code:'42883'}:null}),from:table=>{
    reads++;let counted=false;
    const result=()=>({data:counted?null:storage[table],count:counted?537:null,error:null});
    const q={select:(_columns,opts)=>{counted=Boolean(opts?.count);return q;},eq:()=>q,order:()=>q,limit:()=>q,is:()=>q,lte:()=>q,like:()=>q,
      maybeSingle:async()=>result(),then:(yes,no)=>Promise.resolve(result()).then(yes,no)};
    return q;
  }};
  const exports={};
  vm.runInNewContext(compiled,{exports,supabase,process:{env:{}},Date,Map,Response,NextResponse:{json:Response.json},
    latestSignal:null,displayableCount:0,CRYPTO_OUTCOME_GRACE_MINUTES:10,MAX_CRYPTO_PROX_AGE_HOURS:.25,
    hoursSince:value=>(Date.now()-Date.parse(value))/3_600_000,isObservationOnlyRow,legacyCryptoOutcomeQuarantine,assessCryptoPaperHealth,
    readCryptoOutcomeProcessingEvidence:async()=>({available:!options.processingUnavailable}),
    assessCryptoEvidenceHealth:value=>({
      checks:[{name:'crypto_legacy_evidence_audit',ok:Boolean(value)},{name:'crypto_coinapi_collection',ok:Boolean(value)&&!options.collectionFailed},
        {name:'crypto_coinapi_outcomes',ok:Boolean(value)&&!options.outcomesFailed&&value.outcomeProcessing?.available===true}],
      archiveBySource:Object.fromEntries(['ht_crypto_prox_observations','ht_crypto_discovery_observations'].map(s=>[s,{ok:Boolean(value)}])),
      warnings:[{evaluationEligible:false,records:537}],
    }),fetch:()=>{throw new Error('Network forbidden');}});
  return {response:await exports.run(),reads};
}
test('completed per-record audits preserve old missing counts, warnings and every remaining hard check',async()=>{
  const {response}=await run();const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.ok,true);assert.equal(data.checks.length,6);
  assert.equal(data.warnings[0].evaluationEligible,false);
  assert.ok(data.checks.filter(c=>c.detail?.outcomeEvidence).every(c=>c.detail.overdue15mOutcomes===537 && !c.detail.outcomeEvidence.evaluationEligible));
});
test('missing audit schema cannot green the old sources; failed CoinAPI remains globally red',async()=>{
  for(const options of [{missingAudit:true},{collectionFailed:true},{outcomesFailed:true},{processingUnavailable:true}]) {
    const {response}=await run(undefined,options);const data=await response.json();
    assert.equal(response.status,500);assert.equal(data.ok,false);assert.ok(data.summary.failures.length>0);
    if(options.missingAudit) assert.equal(data.checks.filter(c=>!c.ok).length,5);
  }
});
test('old receipt, exact-set, packet, freshness and provider checks cannot be bypassed by archival completion',async()=>{
  for(const [table,change] of [
    ['ht_crypto_prox_collection_runs',r=>{r.persisted_observation_count=2;}],
    ['ht_crypto_prox_collection_runs',r=>{r.feed_diagnostics.providerFailures=1;}],
    ['ht_crypto_prox_collection_runs',r=>{r.observed_at='2020-01-01T00:00:00Z';}],
    ['ht_crypto_prox_observations',r=>{r[0].product_id='FOREIGN-USD';}],
    ['ht_crypto_prox_observations',r=>{r[0].prox_packet=null;}],
    ['ht_crypto_discovery_runs',r=>{r.expected_candidate_count=2;}],
    ['ht_crypto_discovery_runs',r=>{r.source_diagnostics.healthyVenues=1;}],
    ['ht_crypto_discovery_runs',r=>{r.observed_at='2020-01-01T00:00:00Z';}],
    ['ht_crypto_discovery_observations',r=>{r[0].symbol='WRONG';}],
    ['ht_crypto_discovery_observations',r=>{r[0].discovery_packet=null;}],
  ]) assert.equal((await run(s=>change(s[table]))).response.status,500,table);
});
test('a new legacy deadline is a hard failure in each writer lane',async()=>{
  for(const table of ['ht_crypto_prox_observations','ht_crypto_discovery_observations']) {
    assert.equal((await run(s=>{s[table][0].target_15m_at=new Date().toISOString();})).response.status,500);
  }
});
