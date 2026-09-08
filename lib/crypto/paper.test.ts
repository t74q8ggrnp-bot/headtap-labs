import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node source tests use explicit TypeScript paths.
import {parseCryptoPaperIntent,validCryptoPaperUuid} from './paper-contracts.ts';
// @ts-expect-error Node source tests use explicit TypeScript paths.
import {assessCryptoPaperHealth} from './paper-health.ts';
// @ts-expect-error Node source tests use explicit TypeScript paths.
import {suggestedCryptoPaperLimit} from './paper-price-limit.ts';
const order={marketId:'COINBASE_SPOT_PEPE_USD',side:'buy',quantity:'12.000000000001',limitPrice:'0.000001'};
test('editable price protection has meaningful crypto precision, not floating point artifacts',()=>{
  assert.equal(suggestedCryptoPaperLimit(61001,'buy'),'61306.005');
  assert.equal(suggestedCryptoPaperLimit(.00001245,'buy'),'0.00001251225');
  assert.equal(suggestedCryptoPaperLimit(100,'sell'),'99.5');
  assert.equal(suggestedCryptoPaperLimit(NaN,'buy'),'');
});
test('manual crypto API preserves exact fractional amounts and native USD market identity',()=>{
  assert.deepEqual(parseCryptoPaperIntent(order),order);
  assert.ok(parseCryptoPaperIntent({...order,side:'sell'}));
  assert.ok(validCryptoPaperUuid('0304183b-0faf-4623-873f-1033c4aa981e'));
});
test('untrusted action/identity/number inputs never reach order RPCs',()=>{
  for(const change of [{marketId:'PEPE'},{marketId:'COINBASE_SPOT_PEPE_USDT'},{marketId:'UNKNOWN_SPOT_PEPE_USD'},
    {side:'short'},{side:'cover'},{quantity:['1']},{quantity:{}},{quantity:'NaN'},{quantity:'Infinity'},
    {quantity:'1e9'},{quantity:'-1'},{quantity:'0'},{quantity:'1000000000001'},
    {quantity:'1.1234567890123'},{limitPrice:'0'},{limitPrice:'1000000000'},{limitPrice:[]}
  ]) assert.equal(parseCryptoPaperIntent({...order,...change}),null,JSON.stringify(change));
  assert.equal(parseCryptoPaperIntent([]),null);
});
const healthy={schemaReady:true,policyVersion:'crypto-manual-paper-v1',manualPaperEnabled:true,realExecution:false,
  agentAutopilot:false,accounts:1,fills:3,openOrders:0,overdueOrders:0,accountMismatches:0,positionMismatches:0,orderMismatches:0,auditMismatches:0};
test('paper health requires real counters and complete accounting; paper paused is not corruption',()=>{
  assert.equal(assessCryptoPaperHealth(healthy).ok,true);
  assert.equal(assessCryptoPaperHealth({...healthy,manualPaperEnabled:false}).ok,true);
  for(const change of [{schemaReady:false},{realExecution:true},{agentAutopilot:true},{overdueOrders:1},
    {accountMismatches:1},{positionMismatches:1},{orderMismatches:1},{auditMismatches:1},
    {fills:null},{accounts:'0'},{openOrders:NaN},{manualPaperEnabled:null}]) {
    assert.equal(assessCryptoPaperHealth({...healthy,...change}).ok,false,JSON.stringify(change));
  }
  assert.equal(assessCryptoPaperHealth(null).ok,false);
});
