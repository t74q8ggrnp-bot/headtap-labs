import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { calculatePaperCloseQuantity, calculatePaperFillPrice, calculatePaperOrderImpact, getEasternMarketSession, getPaperDayOrderTradingDate, isPaperCloseRequest, isPaperDayOrderExpired, markPaperPortfolio, normalizePaperCloseIntent, normalizePaperOrderIntent, shouldFillPaperOrder, validatePaperOrder } from "./engine.ts";

const quote = {
  symbol: "AAPL",
  price: 100,
  timestamp: "2026-08-24T14:00:00.000Z",
  source: "massive_polygon_snapshot",
  dataMode: "delayed" as const,
  volume: 2_000_000,
  previousVolume: 10_000_000,
};

test("normalizes a manual long bracket without inventing defaults", () => {
  assert.deepEqual(normalizePaperOrderIntent({
    symbol: " aapl ",
    side: "buy",
    orderType: "market",
    quantity: 2.5,
    takeProfitPrice: 120,
    stopLossPrice: 90,
  }), {
    symbol: "AAPL",
    side: "buy",
    orderType: "market",
    timeInForce: "day",
    quantity: 2.5,
    limitPrice: null,
    stopPrice: null,
    allowExtendedHours: false,
    takeProfitPrice: 120,
    stopLossPrice: 90,
    strategySource: "manual",
  });
});

test("rejects fractional shorts and unavailable buying power", () => {
  const base = normalizePaperOrderIntent({
    symbol: "AAPL", side: "sell_short", orderType: "market", quantity: 2.5,
  });
  assert.ok(base);
  assert.match(
    validatePaperOrder(base, { cashBalance: 100_000, shortMarginHeld: 0, marginEnabled: true }, null, quote).reason ?? "",
    /whole shares/i,
  );

  const buy = normalizePaperOrderIntent({
    symbol: "AAPL", side: "buy", orderType: "market", quantity: 20,
  });
  assert.ok(buy);
  assert.match(
    validatePaperOrder(buy, { cashBalance: 1_000, shortMarginHeld: 0, marginEnabled: true }, null, quote).reason ?? "",
    /buying power/i,
  );
});

test("requires explicit close sides and prevents crossing through zero", () => {
  const sell = normalizePaperOrderIntent({
    symbol: "AAPL", side: "sell", orderType: "market", quantity: 11,
  });
  assert.ok(sell);
  const result = validatePaperOrder(
    sell,
    { cashBalance: 10_000, shortMarginHeld: 0, marginEnabled: true },
    { quantity: 10, averageEntryPrice: 90, shortMarginHeld: 0 },
    quote,
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /exceeds/i);
});

test("keeps an all-position close exact at ledger precision", () => {
  assert.equal(calculatePaperCloseQuantity(1.23456789, 1), 1.23456789);
  assert.equal(calculatePaperCloseQuantity(-1.23456789, 1), 1.23456789);
  assert.equal(calculatePaperCloseQuantity(1.23456789, 0.5), 0.61728394);
});

test("accepts both web and legacy iOS full-position close contracts", () => {
  const long = { quantity: 12.5, averageEntryPrice: 90, shortMarginHeld: 0 };
  const short = { quantity: -8, averageEntryPrice: 110, shortMarginHeld: 400 };

  assert.equal(isPaperCloseRequest({ closePosition: true }), true);
  assert.equal(isPaperCloseRequest({ action: "close_position" }), true);
  assert.deepEqual(normalizePaperCloseIntent({
    action: "close_position",
    symbol: "aapl",
  }, long), {
    symbol: "AAPL",
    side: "sell",
    orderType: "market",
    timeInForce: "day",
    quantity: 12.5,
    limitPrice: null,
    stopPrice: null,
    allowExtendedHours: false,
    takeProfitPrice: null,
    stopLossPrice: null,
    strategySource: "manual",
  });
  assert.equal(
    normalizePaperCloseIntent({
      closePosition: true,
      symbol: "AAPL",
    }, short)?.side,
    "buy_to_cover",
  );
});

test("uses broker-style limit and stop direction", () => {
  assert.equal(shouldFillPaperOrder({ side: "buy", orderType: "limit", limitPrice: 101, stopPrice: null }, 100), true);
  assert.equal(shouldFillPaperOrder({ side: "sell", orderType: "limit", limitPrice: 101, stopPrice: null }, 100), false);
  assert.equal(shouldFillPaperOrder({ side: "buy", orderType: "stop", limitPrice: null, stopPrice: 101 }, 102), true);
  assert.equal(shouldFillPaperOrder({ side: "sell", orderType: "stop", limitPrice: null, stopPrice: 99 }, 98), true);
});

test("applies adverse slippage by side", () => {
  assert.equal(calculatePaperFillPrice("buy", 100, 10), 100.1);
  assert.equal(calculatePaperFillPrice("sell", 100, 10), 99.9);
  assert.equal(calculatePaperFillPrice("sell_short", 100, 10), 99.9);
  assert.equal(calculatePaperFillPrice("buy_to_cover", 100, 10), 100.1);
});

test("previews buying-power impact with the same notional and short-margin rules", () => {
  const account = { cashBalance: 100_000, shortMarginHeld: 0 };
  const buy = calculatePaperOrderImpact({
    side: "buy",
    quantity: 25_000,
    quotePrice: 0.433,
    account,
    position: null,
  });
  assert.equal(buy.estimatedNotional, 10_825);
  assert.equal(buy.buyingPowerAfter, 89_175);

  const short = calculatePaperOrderImpact({
    side: "sell_short",
    quantity: 25_000,
    quotePrice: 0.433,
    account,
    position: null,
  });
  assert.equal(short.estimatedMarginRequired, 5_412.5);
  assert.equal(short.buyingPowerAfter, 94_587.5);

  const cover = calculatePaperOrderImpact({
    side: "buy_to_cover",
    quantity: 50,
    quotePrice: 90,
    account: { cashBalance: 100_000, shortMarginHeld: 5_000 },
    position: {
      quantity: -100,
      averageEntryPrice: 100,
      shortMarginHeld: 5_000,
    },
  });
  assert.equal(cover.estimatedMarginReleased, 2_500);
  assert.equal(cover.estimatedRealizedPnl, 500);
  assert.equal(cover.buyingPowerAfter, 98_000);
});

test("marks long and short holdings without treating short proceeds as cash", () => {
  assert.deepEqual(markPaperPortfolio(
    { cashBalance: 80_000, shortMarginHeld: 5_000, marginEnabled: true },
    [
      { quantity: 100, averageEntryPrice: 100, shortMarginHeld: 0, price: 110 },
      { quantity: -50, averageEntryPrice: 100, shortMarginHeld: 2_500, price: 90 },
    ],
  ), {
    longMarketValue: 11_000,
    shortUnrealizedPnl: 500,
    equity: 91_500,
    buyingPower: 75_000,
  });
});

test("classifies the Eastern regular session independent of host timezone", () => {
  assert.equal(getEasternMarketSession(new Date("2026-08-24T14:00:00.000Z")), "regular");
  assert.equal(getEasternMarketSession(new Date("2026-08-24T12:00:00.000Z")), "premarket");
  assert.equal(getEasternMarketSession(new Date("2026-08-23T14:00:00.000Z")), "closed");
});

test("keeps an after-hours Day order alive for the next eligible session", () => {
  const submittedMondayAfterHours = new Date("2026-08-24T22:00:00.000Z");
  assert.equal(
    getPaperDayOrderTradingDate(submittedMondayAfterHours, false),
    "2026-08-25",
  );
  assert.equal(
    isPaperDayOrderExpired(
      submittedMondayAfterHours,
      new Date("2026-08-25T13:29:00.000Z"),
      false,
    ),
    false,
  );
  assert.equal(
    isPaperDayOrderExpired(
      submittedMondayAfterHours,
      new Date("2026-08-25T20:00:00.000Z"),
      false,
    ),
    true,
  );
});

test("carries a Friday after-hours Day order across the weekend", () => {
  const submittedFridayAfterHours = new Date("2026-08-28T22:00:00.000Z");
  assert.equal(
    getPaperDayOrderTradingDate(submittedFridayAfterHours, false),
    "2026-08-31",
  );
  assert.equal(
    isPaperDayOrderExpired(
      submittedFridayAfterHours,
      new Date("2026-08-31T13:29:00.000Z"),
      false,
    ),
    false,
  );
});
