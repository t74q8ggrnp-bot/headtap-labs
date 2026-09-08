// Exercises the real quote, bulk-quote and chart handlers against the same
// provider evidence. No network, brokerage, database or billed API requests.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as chart from "../lib/market-chart.ts";
import * as timing from "../lib/market-data-time.ts";
import * as snapshots from "../lib/polygon-snapshot.ts";
import * as display from "../lib/stock-display-price.ts";
import { LiveMarketViews, DISPLAY_LIVE_MAX_AGE_MS } from "../lib/live-market-view.ts";

const NOW = Date.parse("2026-09-03T13:42:48Z");
const AT = NOW - 875;
const paths = ["quote", "bulk-quote", "market-chart"];
const compiled = Object.fromEntries(await Promise.all(paths.map(async name => [name,
  ts.transpileModule(await readFile(new URL(`../app/api/${name}/route.ts`, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText])));
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
function harness(options = {}) {
  const snapshot = { ticker: "CHPT", prevDay: { c: 5.19, v: 1e6 },
    day: { c: 7.58, o: 6.9, h: 7.75, l: 6.71, v: 4899258 },
    min: { c: 7.58, t: NOW - 108_000 }, lastTrade: { p: 7.6497, t: AT * 1e6 } };
  if (options.minuteOnly) snapshot.lastTrade.p = 0;
  if (options.future) snapshot.lastTrade.t = (NOW + 3000) * 1e6;
  if (options.missingTime) { delete snapshot.lastTrade.t; delete snapshot.min.t; }
  const direct = options.newerDirect
    ? { price: 7.6555, timestamp: new Date(AT + 400).toISOString(), size: 100 } : null;
  const bars = [0, 60_000].map(offset => ({ t: NOW - 168_000 + offset,
    o: 7.53, h: 7.6, l: 7.52, c: 7.58, v: 1000 }));
  const bindings = {
    "next/server": { NextResponse: Response },
    "@/lib/api-rate-limit": { checkApiRateLimit: () => ({ allowed: true, headers: {} }) },
    "@/lib/market-chart": chart,
    "@/lib/market-data-time": timing,
    "@/lib/polygon-snapshot": snapshots,
    "@/lib/stock-display-price": { resolveStockDisplayPrice: (row, trade) => display.resolveStockDisplayPrice(row, trade, NOW) },
    "@/lib/live-market-view": { DISPLAY_LIVE_MAX_AGE_MS },
    "@/lib/stock-market-session": {
      getStockMarketClock: () => ({ active: !options.closed, session: options.closed ? "closed" : "regular" }),
      stockHistoryLabel: () => options.closed ? "Last session" : "Current session",
    },
    "@/lib/massive-crypto": { fetchMassiveCryptoChart: () => { throw Error("Crypto must not be called"); } },
    "@/lib/intraday-snapshot-hydration": { fetchHydratedSessionSnapshot: async () => null },
    "@/lib/massive-stocks": {
      fetchMassiveStockSnapshot: async () => snapshot,
      fetchMassiveLastTrade: async () => direct,
      fetchMassiveLastQuote: async () => ({ bid: 7.64, ask: 7.65, timestamp: new Date(AT).toISOString() }),
      probeMassiveRealtimeEntitlement: async () => ({ dataMode: "real_time", snapshot: true }),
      massiveStocksUrl: path => `https://test.invalid${path}`,
    },
  };
  const routes = Object.fromEntries(paths.map(name => {
    const exports = {};
    vm.runInNewContext(compiled[name], { exports, URL, URLSearchParams, Response, AbortSignal,
      Date: Clock, console, process: { env: { POLYGON_API_KEY: "test-only" } },
      require: name => { if (!(name in bindings)) throw Error(`Unexpected import: ${name}`); return bindings[name]; },
      fetch: async url => {
        const path = new URL(url).pathname;
        if (path.includes("/snapshot/")) return Response.json({ tickers: [snapshot] });
        if (path.includes("/range/1/minute/")) return Response.json({ results: bars });
        if (path.includes("/range/1/second/")) return Response.json({ results: [] });
        throw Error(`Unexpected request: ${path}`);
      },
    });
    return [name, exports];
  }));
  return async () => {
    const responses = await Promise.all([
      routes.quote.GET(new Request("https://test.invalid/api/quote?symbol=CHPT")),
      routes["bulk-quote"].POST(new Request("https://test.invalid/api/bulk-quote", { method: "POST", body: JSON.stringify({ symbols: ["CHPT"] }) })),
      routes["market-chart"].GET(new Request("https://test.invalid/api/market-chart?asset=stock&symbol=CHPT")),
    ]);
    return { statuses: responses.map(r => r.status), bodies: await Promise.all(responses.map(r => r.json())) };
  };
}

test("all three display routes preserve the CHPT trade/clock pair rather than an older close with a new clock", async () => {
  const { statuses, bodies: [quote, bulk, chart] } = await harness()();
  assert.deepEqual(statuses, [200, 200, 200]);
  for (const value of [quote.c, bulk.quotes.CHPT.price, chart.displayQuote.price, chart.summary.close, chart.bars.at(-1).close]) {
    assert.equal(value, 7.6497);
  }
  for (const value of [quote.asOf, bulk.quotes.CHPT.asOf, chart.displayQuote.asOf]) assert.equal(value, new Date(AT).toISOString());
  for (const client of ["desktop", "mobile"]) {
    const store = new LiveMarketViews({ now: () => NOW, chart: async () => chart, quotes: async () => ({}) });
    store.subscribe("stock:CHPT", () => {}, true);
    await store.poll();
    assert.equal(store.get("stock:CHPT").error, false, client);
    assert.equal(store.get("stock:CHPT").quote.price, 7.6497, client);
    assert.equal(store.get("stock:CHPT").chart.bars.at(-1).close, 7.6497, client);
  }
});

test("a genuinely newer direct print advances both the chart and quote with its own clock", async () => {
  const { bodies: [quote, bulk, chart] } = await harness({ newerDirect: true })();
  assert.equal(quote.c, 7.6555); assert.equal(chart.displayQuote.price, quote.c);
  assert.equal(chart.bars.at(-1).close, quote.c); assert.equal(quote.asOf, new Date(AT + 400).toISOString());
  assert.equal(bulk.quotes.CHPT.price, 7.6497); assert.equal(bulk.quotes.CHPT.asOf, new Date(AT).toISOString());
  // Different observations remain honest, not falsely synchronized by relabeling clocks.
});

test("minute-only and future-trade fallbacks never claim to be live trades", async () => {
  for (const options of [{ minuteOnly: true }, { future: true }]) {
    const { bodies: [quote, bulk, chart] } = await harness(options)();
    for (const value of [quote, bulk.quotes.CHPT, chart.displayQuote]) {
      assert.equal(value.live, false); assert.equal(value.priceKind, "minute_aggregate");
      assert.equal(value.asOf, new Date(NOW - 108_000).toISOString());
    }
    assert.equal(chart.displayQuote.price, chart.bars.at(-1).close);
  }
});

test("closed-session frames preserve their times and never claim Live", async () => {
  const { bodies: [quote, bulk, chart] } = await harness({ closed: true, newerDirect: true })();
  assert.equal(quote.live, false); assert.equal(bulk.quotes.CHPT.live, false); assert.equal(chart.displayQuote.live, false);
  assert.equal(quote.asOf, chart.displayQuote.asOf);
});

test("missing provider clocks fail without fabricating current timestamps", async () => {
  const { statuses, bodies: [quote, bulk, chart] } = await harness({ missingTime: true })();
  assert.equal(statuses[0], 502); assert.equal(quote.c, 0);
  assert.deepEqual(bulk.quotes, {}); assert.equal(chart.displayQuote, undefined);
});
