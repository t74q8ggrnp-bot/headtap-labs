// Run the real API with isolated authentication/ledger doubles. Network forbidden.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as contracts from '../lib/crypto/paper-contracts.ts';
const code=ts.transpileModule(await readFile(new URL('../app/api/crypto/paper/route.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
class CryptoPaperError extends Error {constructor(message,status=409){super(message);this.status=status;}}
function harness(options={}){
  const calls=[];
  const fake=(name)=>async(...args)=>{calls.push({name,args});if(options.error)throw options.error;
    return name==='read' ? {realExecution:false,agentAutopilot:false} : {ok:true,orderId:'saved'};};
  const deps={
    '@/lib/api-rate-limit':{checkApiRateLimit:()=>({allowed:!options.limited,headers:{}})},
    '@/lib/paper-trading/server':{authenticatePaperRequest:async()=>options.signedOut?null:{user:{id:'trusted-user'}}},
    '@/lib/crypto/paper-contracts':contracts,
    '@/lib/crypto/paper-server':{CryptoPaperError,readCryptoPaper:fake('read'),openCryptoPaper:fake('open'),
      previewCryptoPaper:fake('preview'),previewCryptoPaperBudget:fake('dollars'),submitCryptoPaper:fake('submit'),cancelCryptoPaper:fake('cancel')},
  };
  const exports={};vm.runInNewContext(code,{exports,Response,require:n=>{assert.ok(n in deps,`Forbidden dependency ${n}`);return deps[n];},fetch:()=>{throw Error('Network forbidden');}});
  return {calls,run:async(input)=>{
    const method=input===undefined?'GET':'POST';
    const r=await exports[method](new Request('https://fixture.invalid/api/crypto/paper',{method,...(input===undefined?{}:{body:JSON.stringify(input)})}));
    return {status:r.status,headers:r.headers,body:await r.json()};
  }};
}
const intent={marketId:'COINBASE_SPOT_PEPE_USD',side:'buy',quantity:'123.000000000001',limitPrice:'0.000001',
  clientId:'00000000-0000-0000-0000-000000000001',previewCycleId:'00000000-0000-0000-0000-000000000002'};
test('anonymous and rate-limited clients cannot touch the ledger',async()=>{
  for(const [options,status] of [[{signedOut:true},401],[{limited:true},429]]) {
    const h=harness(options);assert.equal((await h.run({action:'open_account'})).status,status);assert.deepEqual(h.calls,[]);
  }
});
test('GET is private/read-only and does not create even a paper account',async()=>{
  const h=harness(),r=await h.run();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);
  assert.deepEqual(h.calls,[{name:'read',args:['trusted-user']}]);assert.equal(r.body.dashboard.realExecution,false);
});
test('only authenticated identity is used; submitted client totals/user ids are ignored',async()=>{
  const h=harness();const r=await h.run({action:'submit',...intent,userId:'victim',total:0,fee:0,executeLive:true});
  assert.equal(r.status,201);assert.equal(h.calls[0].args[0],'trusted-user');
  assert.deepEqual(h.calls[0].args.slice(1),[contracts.parseCryptoPaperIntent(intent),intent.clientId,intent.previewCycleId]);
});
test('dollar sizing is calculated by server; exact sell quantity survives API unchanged',async()=>{
  const h=harness();assert.equal((await h.run({action:'preview',...intent,amountDollars:'25.00'})).status,200);
  assert.deepEqual(h.calls[0],{name:'dollars',args:['trusted-user',intent.marketId,'25.00',intent.limitPrice]});
  await h.run({action:'preview',...intent,side:'sell'});assert.equal(h.calls[1].args[1].quantity,intent.quantity);
});
test('invalid requests fail before ledger calls; cancellation is owner scoped',async()=>{
  const h=harness();
  for(const input of [{action:'execute'},{action:'submit',...intent,clientId:'bad'},
    {action:'preview',...intent,side:'short'},{action:'cancel',orderId:'bad'},{action:'preview',...intent,amountDollars:'Infinity'}]) {
    assert.equal((await h.run(input)).status,400);
  }
  assert.deepEqual(h.calls,[]);await h.run({action:'cancel',orderId:intent.clientId,userId:'victim'});
  assert.deepEqual(h.calls,[{name:'cancel',args:['trusted-user',intent.clientId]}]);
});
test('known ledger rejection is explicit; unknown storage errors never leak internal details',async()=>{
  const a=await harness({error:new CryptoPaperError('Insufficient crypto paper buying power including fees')}).run({action:'submit',...intent});
  assert.equal(a.status,409);assert.match(a.body.error,/Insufficient/);
  const b=await harness({error:new Error('SECRET private SQL')}).run();assert.equal(b.status,503);assert.doesNotMatch(JSON.stringify(b.body),/SECRET/);
});
