// Local-only static layout fixture, NEVER part of a public route or real account.
// Uses the actual component and built CSS. Trade controls here do not send orders.
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {paperFixture,renderPaperFixture} from './test-crypto-paper-render.mjs';
const css=await readFile(`.next/static/css/${(await readdir('.next/static/css')).find(f=>f.endsWith('.css'))}`);
const logo=await readFile('public/logo.png');
const chartJs=await readFile('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/styles.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  if(url.pathname==='/logo.png'){res.setHeader('Content-Type','image/png');return res.end(logo);}
  if(url.pathname==='/chart.js'){res.setHeader('Content-Type','text/javascript');return res.end(chartJs);}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/') return res.end('<html><body style="margin:0;background:#111;color:white;font-family:Arial"><p>ISOLATED LAYOUT TEST · NO REAL PRICES OR ORDERS</p><a style="color:cyan" href="/desktop">Desktop</a> · <a style="color:cyan" href="/mobile">Mobile</a></body></html>');
  if(url.pathname==='/mobile'||url.pathname==='/desktop') return res.end(`<html><body style="margin:0;background:#111;color:#fff;font-family:Arial"><p>ISOLATED ${url.pathname.slice(1).toUpperCase()} TEST · NO ORDERS</p><iframe title="Paper layout fixture" src="/fixture" style="width:${url.pathname==='/mobile'?390:1280}px;height:1100px;border:0;display:block"></iframe></body></html>`);
  const data=structuredClone(paperFixture);data.positions=[{market_id:'COINBASE_SPOT_BTC_USD',quantity:'0.012',available_quantity:'0.012',cost_basis:620,
    marketValue:732,unrealizedPnl:112,priceAsOf:data.feed.publication.markets[0].priceAsOf,current:true}];
  const markup=renderPaperFixture(data);
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link href="/styles.css" rel="stylesheet"></head><body>${markup}
    <script src="/chart.js"></script><script>const el=document.querySelector('[data-paper-fixture-chart]');if(el){const c=LightweightCharts.createChart(el,{height:280,autoSize:true,layout:{background:{type:'solid',color:'#070c0e'},textColor:'#94a3b8'},grid:{vertLines:{color:'#ffffff08'},horzLines:{color:'#ffffff08'}}});c.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#34d399',downColor:'#fb7185',wickUpColor:'#34d399',wickDownColor:'#fb7185',borderVisible:false}).setData(JSON.parse(el.dataset.paperFixtureChart));c.timeScale().fitContent();}</script></body></html>`);
});
server.listen(4182,'127.0.0.1',()=>console.log('Isolated paper layout fixture: http://127.0.0.1:4182'));
