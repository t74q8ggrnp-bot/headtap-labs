// Actual route, isolated dependencies: no database, provider or brokerage access.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {CryptoStorageError} from '../lib/crypto/storage-diagnostics.ts';
const source=await readFile(new URL('../app/api/crypto/coinapi-collector/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run(options={}) {
  const calls=[],logs=[];
  const deps={
    '@/lib/crypto/coinapi-pilot-server':{
      coinApiPilotCronAuthorized:()=>!options.unauthorized,
      runCoinApiPilot:async()=>{calls.push('collect');if(options.failure)throw options.failure;return {status:options.status??'collected',cycleId:'saved-cycle',usage:{requests:3},freshAlignedQuotes:10,scored:2};},
      auditLegacyCryptoBatch:async()=>{calls.push('audit');return options.auditFailure?{ok:false,audited:null,providerRequests:0,diagnostic:{code:'57014',kind:'timeout'}}:{ok:true,audited:20000,providerRequests:0};},
    },
    '@/lib/crypto/storage-diagnostics':{CryptoStorageError},
    '@/lib/crypto/paper-server':{matchCryptoPaperOrders:async()=>{calls.push('paper');return {ok:true,providerRequests:0};}},
  };
  const exports={};
  vm.runInNewContext(compiled,{exports,Response,console:{info:(...a)=>logs.push(a),error:(...a)=>logs.push(a)},require:n=>{assert.ok(n in deps);return deps[n];}});
  const response=await exports.GET(new Request('https://test.invalid'));
  return {response,body:await response.json(),calls,logs};
}
test('unauthenticated and disabled collectors cannot audit or collect',async()=>{
  const unauthorized=await run({unauthorized:true});assert.equal(unauthorized.response.status,401);assert.deepEqual(unauthorized.calls,[]);
  const disabled=await run({status:'disabled'});assert.deepEqual(disabled.calls,['collect','paper']);assert.equal(disabled.body.archiveScheduledSeparately,true);
});
test('live collector never invokes archive work, including when an archive would fail',async()=>{
  const result=await run({auditFailure:true});assert.deepEqual(result.calls,['collect','paper']);
  assert.equal(result.body.status,'collected');assert.equal(result.body.cycleId,'saved-cycle');assert.equal(result.body.archiveScheduledSeparately,true);
});
test('budget-paused collection still manages existing paper orders without running archives',async()=>{
  const result=await run({status:'paused'});assert.deepEqual(result.calls,['collect','paper']);
  assert.equal(result.body.archiveScheduledSeparately,true);
});
test('failed live maintenance preserves its safe error and does not start archive work',async()=>{
  const result=await run({failure:new CryptoStorageError('maintenance',{code:'42501',message:'private'})});
  assert.equal(result.response.status,503);assert.deepEqual(result.calls,['collect','paper']);
  assert.deepEqual(result.body.diagnostic,{stage:'maintenance',code:'42501',kind:'permission_denied'});
  assert.ok(!JSON.stringify(result.logs).includes('private'));
});
