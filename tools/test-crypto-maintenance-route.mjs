import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/api/crypto/evidence-maintenance/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function run({authorized=true,environment='production',ok=true}={}){
  let calls=0;const exports={};
  vm.runInNewContext(compiled,{exports,Response,console:{info:()=>{}},process:{env:{VERCEL_ENV:environment}},
    require:name=>{assert.equal(name,'@/lib/crypto/coinapi-pilot-server');return {
      coinApiPilotCronAuthorized:()=>authorized,auditLegacyCryptoBatch:async()=>{calls++;return {ok,audited:ok?500:null,providerRequests:0};},
    };}});
  const response=await exports.GET(new Request('https://test.invalid'));return {response,body:await response.json(),calls};
}
test('archive maintenance refuses anonymous and nonproduction execution',async()=>{
  const denied=await run({authorized:false});assert.equal(denied.response.status,401);assert.equal(denied.calls,0);
  const preview=await run({environment:'preview'});assert.equal(preview.body.status,'disabled');assert.equal(preview.calls,0);
});
test('archive failure is an explicit failure, not a successful live collector response',async()=>{
  for(const ok of [true,false]){const result=await run({ok});assert.equal(result.response.status,ok?200:503);
    assert.equal(result.calls,1);assert.equal(result.body.providerRequests,0);assert.match(result.response.headers.get('cache-control'),/private, no-store/);}
});
test('existing one-minute paid cadence remains unchanged; archive task is separately scheduled',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.deepEqual(config.crons.filter(c=>c.path==='/api/crypto/coinapi-collector'),[{path:'/api/crypto/coinapi-collector',schedule:'* * * * *'}]);
  assert.equal(config.crons.filter(c=>c.path==='/api/crypto/evidence-maintenance').length,1);
  assert.doesNotMatch(source,/createCoinApiClient|runCoinApiPilot|matchCryptoPaperOrders/);
});
