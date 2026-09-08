// Render the real UI with deterministic hook state. No auth session/network.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMarketPrice } from "../lib/market-price-format.ts";

const source = await readFile(new URL("../app/components/crypto/CoinApiResearchDesk.tsx",import.meta.url),"utf8");
const code = ts.transpileModule(source,{ compilerOptions:{ target:ts.ScriptTarget.ES2022,
  module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX } }).outputText;
function render(research=null,error="",signedIn=true) {
  const states = [research,{ coverage:{ episodes:0,observed_horizons:0,unavailable_horizons:0 } },error,false,signedIn,0,"",null];
  let index=0;
  const exports = {};
  const bindings = {
    react:{ ...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{} },
    "react/jsx-runtime":jsx,
    "next/image":{ default:props=>jsx.jsx("img",props) },
    "next/link":{ default:props=>jsx.jsx("a",props) },
    "@/lib/supabaseClient":{ supabase:{} },
    "@/lib/market-price-format":{ formatMarketPrice },
    "./CoinApiResearchChart":{ default:props=>jsx.jsx("div",{ "data-chart-close":props.bars.at(-1)?.close,"data-market":props.marketId }) },
  };
  vm.runInNewContext(code,{ exports,Intl,Date,Set,
    require:name=>{ if(!(name in bindings)) throw new Error(`Forbidden client dependency ${name}`); return bindings[name]; } });
  return renderToStaticMarkup(jsx.jsx(exports.default,{}));
}
const market = { marketId:"COINBASE_SPOT_TEST_USD",base:"TEST",exchange:"COINBASE",price:.00012345,
  priceAsOf:"2026-09-03T01:00:00Z",book:{ bid:.00012,ask:.00013,asOf:"2026-09-03T01:00:00Z" },
  chart:{ bars:[{time:1788397200,open:.00012,high:.00013,low:.00011,close:.00012345,volume:100}] },
  research:null,researchCollectedAt:"2026-09-03T01:00:01Z",failures:[],coverage:"quote_only_not_deep_scored" };
const base = { status:"disabled",publication:null,frame:null,
  budget:{ daily_credit_limit:300,lifetime_credit_limit:900,lifetime_reserved:0,daily_reserved:25 },
  usage:{reservedToday:0},configuration:{environmentEnabled:true,databaseEnabled:false,credentialConfigured:true} };
test("signed-out desk asks for sign-in instead of inventing prices or connecting a provider",()=>{
  const html=render(null,"",false);
  assert.match(html,/Sign in to HT Labs/); assert.doesNotMatch(html,/TEST\/USD/);
});
test("empty ledger shows its disabled state and distinguishes UTC reserved usage from prior day",()=>{
  const html=render(base);
  assert.match(html,/Waiting for the first saved CoinAPI cycle/);
  assert.match(html,/0 \/ 300/); assert.doesNotMatch(html,/25 \/ 300/);
  assert.match(html,/database switch off/); assert.match(html,/Agent execution remains off/);
});
test("header and chart input share the precise provider price, without stock fallback",()=>{
  const html=render({...base,status:"collecting",publication:{markets:[market]},frame:{selectedMarkets:[market.marketId],summary:{scored:0}}});
  assert.match(html,/0\.00012345/);
  assert.match(html,/data-chart-close="0.00012345"/);
  assert.match(html,/COINBASE_SPOT_TEST_USD/); assert.match(html,/Sep 2.*9:00:00 PM EDT/);
  assert.match(html,/Not deeply analyzed this cycle/);
  assert.doesNotMatch(html,/profit probability|Buy now/i);
  assert.match(html,/sm:grid-cols-2/); assert.match(html,/min-w-0/);
});
test("an unsuccessful read is not displayed as an authenticated healthy connection",()=>{
  const html=render(null,"Connection check failed (prices 503, evidence 200).");
  assert.match(html,/role="alert"/); assert.match(html,/503/);
  assert.doesNotMatch(html,/reads: connected/);
});

const chartCode = ts.transpileModule(await readFile(new URL("../app/components/crypto/CoinApiResearchChart.tsx",import.meta.url),"utf8"),
  { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX } }).outputText;
function chartFixture(mode) {
  const trace = { options:null,series:null,points:null,seriesOptions:null,removed:false };
  let refIndex=0;
  const exports={};
  const scale={ fitContent:()=>{},getVisibleLogicalRange:()=>({from:0,to:2}),setVisibleLogicalRange:()=>{} };
  const bindings={
    react:{ ...React,useState:()=>[mode,()=>{}],useRef:()=>({current:refIndex++ === 0 ? {} : null}),useEffect:fn=>{trace.cleanup=fn();} },
    "react/jsx-runtime":jsx,"@/lib/market-price-format":{formatMarketPrice},
    "lightweight-charts":{ AreaSeries:"area",CandlestickSeries:"candles",ColorType:{Solid:"solid"},
      createChart:(_container,options)=>{trace.options=options;return{
        addSeries:(type,options)=>{trace.series=type;trace.seriesOptions=options;return{setData:points=>{trace.points=points;}};},
        timeScale:()=>scale,remove:()=>{trace.removed=true;},
      };} },
  };
  vm.runInNewContext(chartCode,{exports,Intl,Date,Math,
    require:name=>{if(!(name in bindings)) throw new Error(`Unexpected chart dependency ${name}`);return bindings[name];}});
  renderToStaticMarkup(jsx.jsx(exports.default,{bars:market.chart.bars,marketId:market.marketId}));
  return trace;
}
test("candlestick and line series use identical provider closes and the shared price formatter",()=>{
  for(const mode of ["candles","line"]) {
    const trace=chartFixture(mode);
    assert.equal(trace.series,mode === "candles" ? "candles" : "area");
    const latest=trace.points.at(-1);
    assert.equal(latest.close ?? latest.value,market.price);
    assert.equal(trace.seriesOptions.priceFormat.formatter(market.price),formatMarketPrice(market.price));
    assert.equal(trace.options.localization.priceFormatter(market.price),formatMarketPrice(market.price));
    trace.cleanup(); assert.equal(trace.removed,true);
  }
});
test("chart enables mobile horizontal inspection and pinch, keeping vertical page scrolling",()=>{
  const {options,seriesOptions}=chartFixture("candles");
  assert.equal(options.handleScroll.horzTouchDrag,true); assert.equal(options.handleScroll.vertTouchDrag,false);
  assert.equal(options.handleScale.pinch,true); assert.equal(options.handleScale.mouseWheel,true);
  assert.equal(options.autoSize,true);
  assert.ok(seriesOptions.wickUpColor); assert.ok(seriesOptions.wickDownColor);
  assert.match(options.localization.timeFormatter(Date.parse("2026-09-03T01:00:00Z")/1000),/9:00 PM/);
});
