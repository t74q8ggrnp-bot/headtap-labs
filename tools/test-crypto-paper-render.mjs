// Render the real component with synthetic data only; effects/auth/network disabled.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {formatMarketPrice} from '../lib/market-price-format.ts';
import {suggestedCryptoPaperLimit} from '../lib/crypto/paper-price-limit.ts';
export const paperFixture={contractVersion:'crypto-manual-paper-v1',enabled:true,account:{starting_cash:100000,cash:99380,realized_pnl:12.24},
  reservedCash:0,buyingPower:99380,equity:100112,marksCurrent:true,positions:[],orders:[],fills:[],realExecution:false,agentAutopilot:false,
  feed:{status:'collecting',reason:null,publicationId:'fixture',publication:{markets:[{
    marketId:'COINBASE_SPOT_BTC_USD',exchange:'COINBASE',base:'BTC',price:61000,priceStatus:'current',priceAsOf:new Date().toISOString(),
    coverage:'evaluated',book:{bid:60998,ask:61001,asOf:new Date().toISOString()},
    chart:{bars:Array.from({length:65},(_,i)=>({time:Math.floor(Date.now()/60000)*60-(64-i)*60,
      open:60800+i*3,high:60810+i*3,low:60790+i*3,close:i===64?61000:60803+i*3,volume:2}))}
  },{marketId:'KRAKEN_SPOT_PEPE_USD',exchange:'KRAKEN',base:'PEPE',price:.00001245,priceStatus:'current',priceAsOf:new Date().toISOString(),
    coverage:'quote_only_not_deep_scored',chart:null,book:null}]}}};
const code=ts.transpileModule(await readFile(new URL('../app/components/paper/CryptoPaperDashboard.tsx',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
export function renderPaperFixture(dashboard=paperFixture,overrides={}){
  let state=0;const exports={};
  const deps={react:{...React,useEffect:()=>{},useState:initial=>{
    const id=state++;return React.useState(Object.hasOwn(overrides,id)?overrides[id]:initial);
  }},'react/jsx-runtime':jsx,
    'next/image':{default:props=>{const imageProps={...props};delete imageProps.priority;return jsx.jsx('img',imageProps);}},'next/link':{default:props=>jsx.jsx('a',props)},
    '@/lib/supabaseClient':{supabase:{}},'@/lib/market-price-format':{formatMarketPrice},
    '@/lib/crypto/paper-price-limit':{suggestedCryptoPaperLimit},
    '@/app/components/crypto/CoinApiResearchChart':{default:props=>jsx.jsx('div',{'data-paper-fixture-chart':JSON.stringify(props.bars),
      'data-chart-close':props.bars.at(-1)?.close,'data-market':props.marketId,style:{height:280,width:'100%'}})},
  };
  vm.runInNewContext(code,{exports,Date,Intl,require:n=>{assert.ok(n in deps);return deps[n];}});
  return renderToStaticMarkup(jsx.jsx(exports.default,{initialDashboard:dashboard}));
}
test('paper layout retains visible mobile controls, costs review and exact shared chart price',()=>{
  const html=renderPaperFixture();assert.match(html,/Crypto paper/);assert.match(html,/Review paper order/);
  assert.match(html,/data-chart-close="61000"/);assert.match(html,/61,000/);assert.match(html,/lg:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.doesNotMatch(html,/\bclass="hidden(?: |")/);assert.match(html,/No brokerage connection/);
});
test('paused collection is obvious and blocks new review without hiding balances',()=>{
  const html=renderPaperFixture({...paperFixture,feed:{...paperFixture.feed,status:'paused',reason:'unknown_provider_cost'}});
  assert.match(html,/usage is reconciled/);assert.match(html,/Last available price/);assert.match(html,/disabled=""[^>]*>Review paper order/);
  assert.match(html,/99,380/);
});
test('chosen missing market never substitutes BTC; unavailable chart/quote remains honest',()=>{
  // marketId is the eighth state declared in the real component.
  const html=renderPaperFixture(paperFixture,{7:'COINBASE_SPOT_MISSING_USD'});
  assert.match(html,/MISSING\/USD/);assert.match(html,/another coin will not be substituted/);
  assert.doesNotMatch(html,/data-market="COINBASE_SPOT_BTC_USD"/);
});
test('old provider timestamp cannot remain labeled current between reads',()=>{
  const data=structuredClone(paperFixture);data.feed.publication.markets[0].priceAsOf='2001-01-01T00:00:00Z';
  const html=renderPaperFixture(data);assert.match(html,/Last available price/);assert.doesNotMatch(html,/Current provider price/);
});
test('position mark freshness expires even before a new dashboard read',()=>{
  const data=structuredClone(paperFixture);
  data.positions=[{market_id:'COINBASE_SPOT_BTC_USD',quantity:'0.01',available_quantity:'0.01',
    marketValue:610,unrealizedPnl:1,current:true,priceAsOf:'2001-01-01T00:00:00Z'}];
  const html=renderPaperFixture(data);assert.match(html,/Last available mark/);assert.doesNotMatch(html,/Current mark/);
  assert.match(html,/href="#crypto-paper-ticket"/);assert.match(html,/Sell \/ close/);
});
