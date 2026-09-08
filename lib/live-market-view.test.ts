import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error strip-types runner
import { LiveMarketViews, displayQuoteIsLive, displayQuoteLabel, validDisplayQuote } from "./live-market-view.ts";
// @ts-expect-error strip-types runner
import { formatMarketPrice } from "./market-price-format.ts";
import type { MarketChartResponse } from "./market-chart.ts";

const NOW = Date.parse("2026-09-02T18:30:25Z");
function frame(price = 1.2345, at = NOW): MarketChartResponse {
  const time = Math.floor(at / 60_000) * 60;
  return { success: true, asset: "stock", symbol: "TEST", windowLabel: "Current session", sourceLabel: "Massive",
    latestAt: new Date(time * 1000).toISOString(),
    displayQuote: { price, changePercent: 12, asOf: new Date(at).toISOString(), live: true, source: "massive_polygon_last_trade" },
    summary: { open: price, high: price, low: price, close: price, changePercent: 0 },
    bars: [{ time, open: price, high: price, low: price, close: price, volume: 20 }],
  };
}
function setup() {
  let now = NOW;
  const store = new LiveMarketViews({ now: () => now, chart: async () => frame(), quotes: async () => ({ TEST: frame().displayQuote! }) });
  return { store, advance: (ms: number) => { now += ms; }, now: () => now };
}

test("header and chart subscribers within ONE browser share one atomic frame", async () => {
  let requests = 0;
  const store = new LiveMarketViews({ now: () => NOW, chart: async () => { requests++; return frame(); }, quotes: async () => { throw Error("not used"); } });
  const snapshots: number[] = [];
  for (const chart of [true, true, false, true]) store.subscribe("stock:TEST", () => {
    const view = store.get("stock:TEST");
    assert.equal(view.quote!.price, view.chart!.bars.at(-1)!.close);
    snapshots.push(view.quote!.price);
  }, chart);
  await Promise.all([store.poll(), store.poll(), store.poll()]);
  assert.equal(requests, 1);
  assert.deepEqual(snapshots, [1.2345, 1.2345, 1.2345, 1.2345]);
});

test("a minute-bar fallback is not labeled as a live trade even if its clock is recent", () => {
  const { store } = setup();
  const value = frame(); value.displayQuote!.priceKind = "minute_aggregate";
  store.acceptChart("stock:TEST", value);
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), NOW), false);
  assert.match(displayQuoteLabel(store.get("stock:TEST"), NOW), /^Last minute bar/);
});

test("separate browser stores converge on the same published provider frame, without sharing memory", async () => {
  let published = frame();
  const make = () => new LiveMarketViews({ now: () => NOW, chart: async () => published, quotes: async () => ({}) });
  const desktop = make(), mobile = make();
  desktop.subscribe("stock:TEST", () => {}, true);
  mobile.subscribe("stock:TEST", () => {}, true);
  await desktop.poll(); await mobile.poll();
  assert.deepEqual(desktop.get("stock:TEST").quote, mobile.get("stock:TEST").quote);
  published = frame(1.28);
  await desktop.poll(true);
  // Explicitly document the limit: separate poll cycles are not simultaneous.
  assert.notEqual(desktop.get("stock:TEST").quote!.price, mobile.get("stock:TEST").quote!.price);
  await mobile.poll(true);
  assert.deepEqual(desktop.get("stock:TEST").quote, mobile.get("stock:TEST").quote);
  for (const store of [desktop, mobile]) {
    assert.equal(store.get("stock:TEST").quote!.price, store.get("stock:TEST").chart!.bars.at(-1)!.close);
  }
});

test("older quotes, candles, wrong symbols and mismatched current prices are rejected", () => {
  const { store } = setup();
  store.subscribe("stock:TEST", () => {}, true);
  assert.equal(store.acceptChart("stock:TEST", frame()), true);
  assert.equal(store.acceptChart("stock:TEST", frame(2, NOW - 1000)), false);
  assert.equal(store.acceptChart("stock:OTHER", frame()), false);
  const mismatch = frame(); mismatch.bars[0].close = 9;
  assert.equal(store.acceptChart("stock:TEST", mismatch), false);
  const wrongMinute = frame(); wrongMinute.bars[0].time -= 60;
  assert.equal(store.acceptChart("stock:TEST", wrongMinute), false);
  assert.equal(store.acceptQuote("stock:TEST", frame(5).displayQuote!), false);
  assert.equal(store.get("stock:TEST").quote!.price, 1.2345);
});

test("malformed candle data cannot enter the shared display", () => {
  const { store } = setup();
  for (const corrupt of [(v: MarketChartResponse) => { v.bars[0].volume = NaN; },
    (v: MarketChartResponse) => { v.bars[0].high = 0.01; },
    (v: MarketChartResponse) => { v.summary.close = 5; }]) {
    const value = frame(); corrupt(value);
    assert.equal(store.acceptChart("stock:TEST", value), false);
  }
});

test("future, missing and invalid provider timestamps never become Live", () => {
  assert.equal(validDisplayQuote(frame(1, NOW + 3000).displayQuote, NOW), false);
  assert.equal(validDisplayQuote({ ...frame().displayQuote!, asOf: "" }, NOW), false);
  assert.equal(validDisplayQuote({ ...frame().displayQuote!, price: NaN }, NOW), false);
});

test("Live expires by source age, not by the fact a request just succeeded", () => {
  const { store, advance, now } = setup();
  store.acceptChart("stock:TEST", frame());
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), now()), true);
  advance(31_000);
  store.acceptChart("stock:TEST", frame());
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), now()), false);
  assert.match(displayQuoteLabel(store.get("stock:TEST"), now()), /Last trade/);
  const closed = frame(1, now()); closed.displayQuote!.live = false;
  store.acceptChart("stock:TEST", closed);
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), now()), false);
});

test("desktop/mobile shared stock view loses Live at the close without waiting for polling", async () => {
  let now = Date.parse("2026-09-02T23:59:59Z");
  const value = frame(1.2345, now);
  const store = new LiveMarketViews({ now: () => now, chart: async () => value, quotes: async () => ({}) });
  for (const chart of [true, true, false]) store.subscribe("stock:TEST", () => {}, chart);
  await store.poll();
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), now), true);
  now += 1000;
  const view = store.get("stock:TEST");
  assert.equal(displayQuoteIsLive(view, now), false);
  assert.match(displayQuoteLabel(view, now), /^Last session · 2026-09-02/);
  assert.equal(view.quote!.price, view.chart!.bars.at(-1)!.close);
  assert.equal(view.quote!.asOf, "2026-09-02T23:59:59.000Z");
  assert.equal(displayQuoteIsLive(view, now, "crypto"), true);
  assert.match(displayQuoteLabel(view, now, "crypto"), /^Live/);
});

test("network failure retains matching data but removes Live; resume recovers", async () => {
  let failed = false;
  const store = new LiveMarketViews({ now: () => NOW, chart: async () => { if (failed) throw Error("offline"); return frame(); }, quotes: async () => ({}) });
  store.subscribe("stock:TEST", () => {}, true);
  await store.poll(); failed = true;
  await store.poll(true);
  assert.equal(store.get("stock:TEST").quote!.price, 1.2345);
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), NOW), false);
  assert.match(displayQuoteLabel(store.get("stock:TEST"), NOW), /reconnecting/);
  failed = false; await store.poll(true);
  assert.equal(displayQuoteIsLive(store.get("stock:TEST"), NOW), true);
});

test("a chart mounting during a quote request prevents an older independent header update", async () => {
  let resolve!: (value: Record<string, NonNullable<MarketChartResponse["displayQuote"]>>) => void;
  const store = new LiveMarketViews({ now: () => NOW, chart: async () => frame(),
    quotes: () => new Promise(r => { resolve = r; }) });
  store.subscribe("stock:TEST", () => {}, false);
  const pending = store.poll();
  store.subscribe("stock:TEST", () => {}, true);
  resolve({ TEST: frame(10).displayQuote! });
  await pending;
  assert.equal(store.get("stock:TEST").quote, null);
  await store.poll();
  assert.equal(store.get("stock:TEST").quote!.price, 1.2345);
});

test("quote-only lists batch symbols and cannot replace a newer quote with an older response", async () => {
  const batches: string[][] = [];
  const store = new LiveMarketViews({ now: () => NOW, chart: async () => frame(), quotes: async symbols => {
    batches.push(symbols); return Object.fromEntries(symbols.map(symbol => [symbol, frame().displayQuote!]));
  } });
  store.subscribe("stock:TEST", () => {}, false); store.subscribe("stock:XYZ", () => {}, false);
  await store.poll();
  assert.deepEqual(batches, [["TEST", "XYZ"]]);
  assert.equal(store.acceptQuote("stock:TEST", frame(7, NOW - 1000).displayQuote!), false);
});

test("stock quote polling advances on shared five-second wall-clock buckets", async () => {
  let now = NOW;
  let requests = 0;
  const store = new LiveMarketViews({
    now: () => now,
    chart: async () => frame(),
    quotes: async () => { requests++; return { TEST: frame(1, now).displayQuote! }; },
  });
  store.subscribe("stock:TEST", () => {}, false);
  await store.poll();
  now += 4_000;
  await store.poll();
  assert.equal(requests, 1);
  now += 1_000;
  await store.poll();
  assert.equal(requests, 2);
});

test("one current-price formatter retains sub-dollar and crypto precision", () => {
  assert.equal(formatMarketPrice(1.8001), "$1.8001");
  assert.equal(formatMarketPrice(0.12824), "$0.12824");
  assert.equal(formatMarketPrice(0.0000001234), "$0.0000001234");
  assert.equal(formatMarketPrice(5), "$5.00");
  assert.equal(formatMarketPrice(null), "—");
});

test("a preserved five-minute exchange candle still shares its exact live trade with the header", () => {
  const { store } = setup();
  const value = frame(); value.asset = "crypto"; value.symbol = "SKR"; value.productId = "SKR-USD";
  value.intervalSeconds = 300; value.bars[0].time = Math.floor(NOW / 300_000) * 300;
  value.displayQuote!.source = "coinbase_crypto_trade";
  assert.equal(store.acceptChart("crypto:SKR-USD", value), true);
  assert.equal(store.get("crypto:SKR-USD").quote!.price, store.get("crypto:SKR-USD").chart!.bars[0].close);
});

test("crypto quote lists batch independently and cannot override a selected coin's candle", async () => {
  const batches: string[][] = [];
  const store = new LiveMarketViews({ now: () => NOW, chart: async () => {
    const value = frame(); return { ...value, asset: "crypto", symbol: "BTC", productId: "BTC-USD" };
  }, quotes: async () => ({}), cryptoQuotes: async products => {
    batches.push(products); return Object.fromEntries(products.map(p => [p, frame().displayQuote!]));
  } });
  store.subscribe("crypto:BTC-USD", () => {}, true);
  store.subscribe("crypto:ETH-USD", () => {}, false);
  store.subscribe("crypto:SKR-USD", () => {}, false);
  await store.poll();
  assert.deepEqual(batches, [["ETH-USD", "SKR-USD"]]);
  assert.equal(store.acceptQuote("crypto:BTC-USD", frame(99).displayQuote!), false);
});
