import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node source imports.
import { createStreamMeasurement, streamSubscription, validateStreamTestPlan } from "./coinapi-stream-measurement.ts";

const start = Date.parse("2026-09-03T12:00:00Z");
const market = "COINBASE_SPOT_DOGE_USD";
const plan = { marketIds: [market], durationSeconds: 180, maxPayloadBytes: 8 * 1024 ** 2, quoteIntervalMs: 1000 };
const iso = (offset = 1000) => new Date(start + offset).toISOString();
const trade = (overrides = {}) => ({ type: "trade", symbol_id: market, sequence: 1,
  time_exchange: iso(), time_coinapi: iso(), price: .1234, size: 10,
  uuid: "11111111-1111-4111-8111-111111111111", ...overrides });
const quote = (overrides = {}) => ({ type: "quote", symbol_id: market, sequence: 1,
  time_exchange: iso(), time_coinapi: iso(), bid_price: .1233, ask_price: .1235, ...overrides });
const push = (meter: ReturnType<typeof createStreamMeasurement>, row: unknown, at = start + 1000) => meter.record(JSON.stringify(row), at);

test("exact filters, native USD, and bounded scope prevent wildcard subscriptions", () => {
  const subscription = streamSubscription(plan);
  assert.deepEqual(subscription.subscribe_filter_symbol_id, [`${market}$`]);
  assert.deepEqual(subscription.subscribe_data_type, ["quote", "trade"]);
  for (const marketIds of [[], [market, market], ["COINBASE"], ["COINBASE_SPOT_BTC_USDT"], [`${market}$`], ["*"]]) {
    assert.throws(() => validateStreamTestPlan({ ...plan, marketIds }));
  }
  for (const durationSeconds of [0, 301, Infinity, NaN]) assert.throws(() => validateStreamTestPlan({ ...plan, durationSeconds }));
  assert.throws(() => validateStreamTestPlan({ ...plan, maxPayloadBytes: 9 * 1024 ** 2 }));
});

test("last trade and candle share provider price, not quote midpoint or receipt time", () => {
  const meter = createStreamMeasurement(plan, start);
  push(meter, trade()); push(meter, quote({ bid_price: .14, ask_price: .16 }));
  const row = meter.report(start + 2000, "duration_limit").samples[0];
  assert.equal(row.trade?.price, .1234); assert.equal(row.observedCandles[0].close, .1234);
  assert.equal(row.trade?.exchange.raw, iso()); assert.equal(row.quote?.bid, .14);
  assert.equal(row.lastTradeMatchesObservedCandle, true);
  assert.equal(row.candleCompletenessVerified, false);
});

test("duplicate trades never inflate candle volume", () => {
  const meter = createStreamMeasurement(plan, start);
  push(meter, trade()); push(meter, trade());
  const row = meter.report(start + 2000, "operator_stop").samples[0];
  assert.equal(row.trades, 1); assert.equal(row.duplicateTrades, 1); assert.equal(row.observedCandles[0].volume, 10);
});

test("out-of-order sub-millisecond trade clocks cannot regress the latest price", () => {
  const meter = createStreamMeasurement(plan, start);
  push(meter, trade({ sequence: 2, time_exchange: "2026-09-03T12:00:01.0009000Z", price: .2 }));
  push(meter, trade({ time_exchange: "2026-09-03T12:00:01.0001000Z", price: .1,
    uuid: "22222222-2222-4222-8222-222222222222" }));
  const row = meter.report(start + 2000, "operator_stop").samples[0];
  assert.equal(row.outOfOrderTimes, 1); assert.equal(row.sequenceRegressions, 1);
  assert.equal(row.trade?.price, .2); assert.equal(row.observedCandles[0].close, .2);
  assert.equal(row.observedCandles[0].open, .1); assert.equal(row.observedCandles[0].volume, 20);
});

test("provider times stay independent; stale or missing books cannot become fresh from receipt time", () => {
  const meter = createStreamMeasurement(plan, start);
  push(meter, trade()); push(meter, quote({ time_exchange: iso(-60_000) }));
  const report = meter.report(start + 2000, "operator_stop");
  assert.equal(report.coverage.freshAlignedAtEnd, 0); assert.equal(report.samples[0].staleAtReceipt, 1);
  assert.equal(report.samples[0].quote?.exchange.raw, iso(-60_000));
  push(meter, quote({ time_exchange: undefined }));
  push(meter, quote({ time_exchange: iso(100_000) }));
  push(meter, quote({ time_exchange: "2026-02-30T00:00:00Z" }));
  assert.equal(meter.report(start + 2000, "operator_stop").samples[0].invalid, 3);
});

test("malformed prices and zero-size marks are not converted to candle trades", () => {
  const meter = createStreamMeasurement(plan, start);
  for (const row of [trade({ price: 0 }), trade({ size: 0 }), trade({ uuid: undefined }), quote({ ask_price: .1 })]) push(meter, row);
  const row = meter.report(start + 2000, "operator_stop").samples[0];
  assert.equal(row.invalid, 4); assert.equal(row.observedCandles.length, 0); assert.equal(row.trade, null);
});

test("trade sequence gaps and quote throttling are reported separately", () => {
  const meter = createStreamMeasurement(plan, start);
  push(meter, trade()); push(meter, quote());
  push(meter, trade({ sequence: 4, uuid: "22222222-2222-4222-8222-222222222222" }));
  push(meter, quote({ sequence: 8 }));
  const row = meter.report(start + 2000, "operator_stop").samples[0];
  assert.equal(row.tradeSequenceGaps, 2); assert.equal(row.quoteSequenceJumps, 1);
});

test("empty minutes remain absent and old prints do not fabricate history", () => {
  const meter = createStreamMeasurement(plan, start);
  push(meter, trade({ time_exchange: iso(-60_000) }));
  push(meter, trade({ sequence: 2, time_exchange: iso(121_000), time_coinapi: iso(121_000), uuid: "22222222-2222-4222-8222-222222222222" }), start + 121_000);
  const bars = meter.report(start + 122_000, "operator_stop").samples[0].observedCandles;
  assert.equal(bars.length, 1); assert.equal(bars[0].minute, start + 120_000);
});

test("errors, unexpected markets and higher-priced data types stop instead of retrying", () => {
  for (const [row, reason] of [[{ type: "error", message: "secret" }, "provider_error"],
    [trade({ symbol_id: "COINBASE_SPOT_BTC_USD" }), "unexpected_market"], [{ type: "ohlcv" }, "unexpected_data_type"]] as const) {
    const meter = createStreamMeasurement(plan, start);
    assert.equal(push(meter, row), reason);
    const report = meter.report(start + 31_000, "duration_limit");
    assert.equal(report.billing.projected30DayTier1PayloadUsd, null);
    assert.equal(JSON.stringify(report).includes("secret"), false);
    assert.equal(report.reconnectAttempts, 0);
  }
});

test("payload crossing message is counted, but not passed off as a hard billing cap", () => {
  const meter = createStreamMeasurement({ ...plan, maxPayloadBytes: 1024 }, start);
  const raw = JSON.stringify(trade({ extra: "x".repeat(2000) }));
  assert.equal(meter.record(raw, start + 1000), "payload_limit");
  const report = meter.report(start + 31_000, "duration_limit");
  assert.equal(report.payloadBytes, new TextEncoder().encode(raw).byteLength);
  assert.equal(report.billing.providerReportedUsd, null);
  assert.equal(report.billing.accountWideSpendingCapVerified, false);
});

test("traffic estimates are sample-only, never an invoice, universe estimate or profit result", () => {
  const meter = createStreamMeasurement(plan, start);
  const raw = JSON.stringify(trade()); meter.record(raw, start + 1000);
  const report = meter.report(start + 180_000, "duration_limit");
  assert.equal(report.billing.estimatedTier1PayloadUsd, Buffer.byteLength(raw) / 1024 ** 3);
  assert.equal(report.billing.projected30DayTier1PayloadUsd, Buffer.byteLength(raw) / 180 * 86400 * 30 / 1024 ** 3);
  assert.equal(report.billing.totalMonthlyUsd, null); assert.equal(report.billing.providerReceiptVerified, false);
  assert.equal(report.coverage.wholeUniverseMeasured, false); assert.equal(report.executionAuthorized, false);
  assert.equal(report.profitabilityEstablished, false); assert.equal(report.publicFeedChanged, false);
  assert.equal(report.providerRestRequests, 0);
  assert.equal(createStreamMeasurement(plan, start).report(start + 180_000, "duration_limit").billing.projected30DayTier1PayloadUsd, null);
});
