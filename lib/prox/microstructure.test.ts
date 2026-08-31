import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { summarizeProxMicrostructure } from "./microstructure.ts";

test("microstructure summary preserves quote and trade facts without scoring", () => {
  const summary = summarizeProxMicrostructure({
    ticker: "test",
    quote: {
      bid: 9.9,
      ask: 10.1,
      bidSize: 300,
      askSize: 200,
      timestamp: "2026-08-31T14:00:02.000Z",
    },
    trades: [
      {
        id: "1",
        price: 10,
        size: 100,
        exchange: 4,
        conditions: [12],
        timestamp: "2026-08-31T14:00:01.000Z",
      },
      {
        id: "2",
        price: 10.05,
        size: 50,
        exchange: 11,
        conditions: [12, 41],
        timestamp: "2026-08-31T14:00:03.000Z",
      },
    ],
  });

  assert.equal(summary.ticker, "TEST");
  assert.equal(summary.midpointPrice, 10);
  assert.equal(summary.spreadDollars, 0.2);
  assert.equal(summary.spreadPercent, 2);
  assert.equal(summary.lastTradePrice, 10.05);
  assert.equal(summary.recentTradeCount, 2);
  assert.equal(summary.recentTradeVolume, 150);
  assert.equal(summary.recentTradeNotional, 1502.5);
  assert.equal(summary.largestTradeSize, 100);
  assert.equal(summary.exchangeCount, 2);
  assert.deepEqual(summary.conditionCodes, [12, 41]);
  assert.equal(summary.marketAsOf, "2026-08-31T14:00:03.000Z");
  assert.equal("score" in summary, false);
});

test("crossed quotes are retained as raw facts but do not fabricate spread math", () => {
  const summary = summarizeProxMicrostructure({
    ticker: "TEST",
    quote: {
      bid: 10.2,
      ask: 10.1,
      bidSize: 10,
      askSize: 10,
      timestamp: "2026-08-31T14:00:00.000Z",
    },
    trades: [],
  });
  assert.equal(summary.bidPrice, 10.2);
  assert.equal(summary.askPrice, 10.1);
  assert.equal(summary.midpointPrice, null);
  assert.equal(summary.spreadDollars, null);
  assert.equal(summary.spreadPercent, null);
});
