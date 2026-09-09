import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { createProviderRequestInstrumentation, marketBarsAtOrBeforeProviderTimestamp, marketChartBarsInDisplayedSession, marketChartFeedFrameForSymbol, marketChartFeedFrameFromBootstrap, marketChartSecondAggregateWindowStart, mergeMarketChartFeedDelta, resolveMarketChartDisplayedSessionDate, resolveMarketChartSessionAuthority, summarizeMarketChartFeedEfficiency, validCurrentMarketChartFrame, validMarketChartBootstrapResponse, validMarketChartDeltaResponse, type MarketChartBootstrapResponse, type MarketChartDeltaResponse, type MarketProviderRequestKind } from "./market-chart-feed.ts";

function bootstrap(): MarketChartBootstrapResponse {
  const time = Date.parse("2026-09-08T14:00:00.000Z") / 1_000;
  return {
    success: true,
    asset: "stock",
    symbol: "SPY",
    windowLabel: "Current session",
    sourceLabel: "Massive",
    latestAt: new Date(time * 1_000).toISOString(),
    intervalSeconds: 60,
    displayQuote: {
      price: 100,
      changePercent: 1,
      asOf: "2026-09-08T14:00:20.000Z",
      live: true,
      source: "massive_polygon_last_trade",
      priceKind: "trade",
    },
    summary: { open: 99, high: 100, low: 99, close: 100, changePercent: 1.01 },
    bars: [
      { time: time - 60, open: 99, high: 99.5, low: 99, close: 99.5, volume: 8 },
      { time, open: 99.5, high: 100, low: 99.5, close: 100, volume: 10 },
    ],
    feedVersion: "market-chart-feed-v1",
    feedPhase: "bootstrap",
    previousClose: 99,
    sessionAuthority: resolveMarketChartSessionAuthority({
      providerTimestamp: "2026-09-08T14:00:20.000Z",
      displayedSessionDate: "2026-09-08",
      sessionScope: "extended",
    }),
    instrumentation: createProviderRequestInstrumentation({
      phase: "bootstrap",
      requests: (["minute_history", "second_delta", "snapshot", "last_trade"] as MarketProviderRequestKind[]).map(
        (kind) => ({ kind, attempted: true, succeeded: true }),
      ),
    }),
  };
}

function delta(at: string, price: number): MarketChartDeltaResponse {
  const time = Math.floor(Date.parse(at) / 60_000) * 60;
  const authority = resolveMarketChartSessionAuthority({
    providerTimestamp: at,
    displayedSessionDate: "2026-09-08",
    sessionScope: "extended",
  });
  return {
    success: true,
    asset: "stock",
    symbol: "SPY",
    feedVersion: "market-chart-feed-v1",
    feedPhase: "delta",
    bars: [{
      time,
      open: 100,
      high: Math.max(100, price),
      low: Math.min(100, price),
      close: price,
      volume: 20,
    }],
    displayQuote: {
      price,
      changePercent: 2,
      asOf: at,
      live: true,
      source: "massive_polygon_last_trade",
      priceKind: "trade",
    },
    latestAt: new Date(time * 1_000).toISOString(),
    intervalSeconds: 60,
    sessionAuthority: authority,
    instrumentation: createProviderRequestInstrumentation({
      phase: "delta",
      requests: (["second_delta", "last_trade"] as MarketProviderRequestKind[]).map((kind) => ({
        kind,
        attempted: true,
        succeeded: true,
      })),
    }),
  };
}

test("regular-only charts reject an after-hours trade without relabeling its provider time", () => {
  const authority = resolveMarketChartSessionAuthority({
    providerTimestamp: "2026-09-08T21:10:34.000Z",
    displayedSessionDate: "2026-09-08",
    sessionScope: "regular",
  });
  assert.equal(authority.providerSession, "after_hours");
  assert.equal(authority.providerTimestamp, "2026-09-08T21:10:34.000Z");
  assert.equal(authority.candleIntervalTimestamp, "2026-09-08T21:10:00.000Z");
  assert.equal(authority.displayPriceAppliedToCandle, false);
  assert.equal(authority.reason, "outside_session_scope");
});

test("extended-hours charts align provider time to its distinct candle bucket", () => {
  const authority = resolveMarketChartSessionAuthority({
    providerTimestamp: "2026-09-08T12:05:42.345Z",
    displayedSessionDate: "2026-09-08",
    sessionScope: "extended",
  });
  assert.equal(authority.providerSession, "pre_market");
  assert.equal(authority.providerTimestamp, "2026-09-08T12:05:42.345Z");
  assert.equal(authority.candleIntervalTimestamp, "2026-09-08T12:05:00.000Z");
  assert.equal(authority.displayPriceAppliedToCandle, true);
});

test("an in-scope first trade advances a new session but cannot mutate an RTH-only chart", () => {
  const yesterdayClose = "2026-09-07T19:59:00.000Z";
  const todayPremarket = "2026-09-08T12:05:42.345Z";
  assert.equal(resolveMarketChartDisplayedSessionDate({
    latestAggregateTimestamp: yesterdayClose,
    providerTimestamp: todayPremarket,
    sessionScope: "extended",
  }), "2026-09-08");
  assert.equal(resolveMarketChartDisplayedSessionDate({
    latestAggregateTimestamp: yesterdayClose,
    providerTimestamp: todayPremarket,
    sessionScope: "regular",
  }), "2026-09-07");
});

test("a delta advances the same immutable frame without reloading history", () => {
  const current = marketChartFeedFrameFromBootstrap(bootstrap());
  const next = mergeMarketChartFeedDelta(
    current,
    delta("2026-09-08T14:00:45.000Z", 101),
  );
  assert.equal(next.chart.displayQuote?.price, 101);
  assert.equal(next.chart.bars.at(-1)?.close, 101);
  assert.equal(next.chart.summary.close, 101);
  assert.equal(next.instrumentation.totalProviderRequests, 6);
  assert.equal(next.instrumentation.legacyEquivalentRequests, 8);
});

test("a legacy chart validates its current frame without stale bootstrap telemetry", () => {
  const initial = bootstrap();
  initial.instrumentation = createProviderRequestInstrumentation({
    phase: "bootstrap",
    requestStartedAt: "2026-09-08T14:00:20.000Z",
    responseCompletedAt: "2026-09-08T14:00:21.000Z",
    requests: (["minute_history", "second_delta", "snapshot", "last_trade"] as MarketProviderRequestKind[]).map(
      (kind) => ({ kind, attempted: true, succeeded: true }),
    ),
  });
  const advanced = mergeMarketChartFeedDelta(
    marketChartFeedFrameFromBootstrap(initial),
    delta("2026-09-08T14:00:45.000Z", 101),
  );
  const legacyCurrent = {
    ...advanced.chart,
    feedVersion: "market-chart-feed-v1" as const,
    feedPhase: "bootstrap" as const,
    previousClose: advanced.previousClose,
    sessionAuthority: advanced.sessionAuthority,
    instrumentation: initial.instrumentation,
  };
  const request = {
    asset: "stock" as const,
    symbol: "SPY",
    sessionScope: "extended" as const,
    displayedSessionDate: "2026-09-08",
  };
  assert.equal(validMarketChartBootstrapResponse(legacyCurrent, request), false);
  assert.equal(validCurrentMarketChartFrame(
    legacyCurrent,
    request,
    Date.parse("2026-09-08T14:00:46.000Z"),
  ), true);
});

test("a prior ticker frame is hidden immediately when navigation changes the symbol", () => {
  const current = marketChartFeedFrameFromBootstrap(bootstrap());
  assert.equal(marketChartFeedFrameForSymbol(current, "SPY"), current);
  assert.equal(marketChartFeedFrameForSymbol(current, "TSLA"), null);
});

test("a future streaming delta can omit REST request telemetry", () => {
  const current = marketChartFeedFrameFromBootstrap(bootstrap());
  const streamed = delta("2026-09-08T14:00:45.000Z", 101);
  delete streamed.instrumentation;
  assert.equal(validMarketChartDeltaResponse(streamed, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }), true);
  const next = mergeMarketChartFeedDelta(current, streamed);
  assert.equal(next.chart.displayQuote?.price, 101);
  assert.equal(next.chart.bars.at(-1)?.close, 101);
  assert.equal(next.instrumentation.totalProviderRequests, 4);
  assert.equal(next.instrumentation.legacyEquivalentRequests, 4);
});

test("out-of-order deltas cannot move a chart backward", () => {
  const current = marketChartFeedFrameFromBootstrap(bootstrap());
  const next = mergeMarketChartFeedDelta(
    current,
    delta("2026-09-08T13:59:59.000Z", 80),
  );
  assert.equal(next.chart, current.chart);
  assert.equal(next.receivedAt, current.receivedAt);
  assert.equal(next.instrumentation.totalProviderRequests, 6);
  assert.equal(next.instrumentation.legacyEquivalentRequests, 8);
});

test("an equal provider timestamp is idempotent and cannot rewrite price", () => {
  const current = marketChartFeedFrameFromBootstrap(bootstrap());
  const next = mergeMarketChartFeedDelta(
    current,
    delta("2026-09-08T14:00:20.000Z", 80),
  );
  assert.equal(next.chart.displayQuote?.price, 100);
  assert.equal(next.chart.bars.at(-1)?.close, 100);
  assert.equal(next.instrumentation.totalProviderRequests, 6);
});

test("an equal provider timestamp can downgrade Live but cannot renew freshness", () => {
  const current = marketChartFeedFrameFromBootstrap(bootstrap(), 1_000);
  const unchanged = delta("2026-09-08T14:00:20.000Z", 100);
  unchanged.displayQuote.live = false;
  const next = mergeMarketChartFeedDelta(current, unchanged, 99_000);
  assert.equal(next.chart.displayQuote?.live, false);
  assert.equal(next.receivedAt, 1_000);
  assert.equal(validCurrentMarketChartFrame(next.chart, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }, Date.parse("2026-09-08T14:01:00.000Z")), true);
});

test("instrumentation proves two delta calls replace each legacy four-call refresh", () => {
  const receipt = createProviderRequestInstrumentation({
    phase: "delta",
    requests: (["second_delta", "last_trade"] as MarketProviderRequestKind[]).map((kind) => ({
      kind,
      attempted: true,
      succeeded: true,
    })),
  });
  assert.equal(receipt.providerRequestCount, 2);
  assert.equal(receipt.legacyEquivalentRequestCount, 4);
});

test("instrumentation separates provider calls from accepted reused evidence", () => {
  const receipt = createProviderRequestInstrumentation({
    phase: "delta",
    requests: [
      {
        kind: "second_delta",
        attempted: false,
        succeeded: false,
        delivery: "single_flight",
        evidenceAccepted: true,
        evidenceAgeMs: 0,
      },
      {
        kind: "last_trade",
        attempted: false,
        succeeded: false,
        delivery: "ttl_cache",
        evidenceAccepted: true,
        evidenceAgeMs: 1_500,
      },
    ],
  });
  assert.equal(receipt.providerRequestCount, 0);
  assert.equal(receipt.acceptedEvidenceCount, 2);
  assert.equal(receipt.reusedEvidenceCount, 2);
  assert.deepEqual(
    receipt.requests.map((request) => request.delivery),
    ["single_flight", "ttl_cache"],
  );
});

test("runtime contracts reject a mismatched shared price or requested symbol", () => {
  const validBootstrap = bootstrap();
  assert.equal(validMarketChartBootstrapResponse(validBootstrap, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
  }), true);
  assert.equal(validMarketChartBootstrapResponse({
    ...validBootstrap,
    bars: validBootstrap.bars.map((bar, index) =>
      index === validBootstrap.bars.length - 1 ? { ...bar, close: 99.9 } : bar,
    ),
  }, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
  }), false);
  assert.equal(validMarketChartBootstrapResponse({
    ...validBootstrap,
    latestAt: "2026-09-08T14:01:00.000Z",
  }, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
  }), false);

  const validDelta = delta("2026-09-08T14:01:20.000Z", 101);
  assert.equal(validMarketChartDeltaResponse(validDelta, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }), true);
  assert.equal(validMarketChartDeltaResponse({
    ...validDelta,
    bars: validDelta.bars.map((bar, index) =>
      index === validDelta.bars.length - 1
        ? { ...bar, close: validDelta.displayQuote.price - 0.01 }
        : bar
    ),
  }, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }), false);
  assert.equal(validMarketChartDeltaResponse(validDelta, {
    asset: "stock",
    symbol: "QQQ",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }), false);
});

test("a stock bootstrap without a verified display frame is never a valid success payload", () => {
  const malformed = { ...bootstrap() };
  delete malformed.displayQuote;
  assert.equal(validMarketChartBootstrapResponse(malformed, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
  }), false);
});

test("runtime contracts reject malformed or future-dated shared quote metadata", () => {
  const validDelta = delta("2026-09-08T14:01:20.000Z", 101);
  const request = {
    asset: "stock" as const,
    symbol: "SPY",
    sessionScope: "extended" as const,
    displayedSessionDate: "2026-09-08",
  };

  for (const displayQuote of [
    { ...validDelta.displayQuote, live: "false" },
    { ...validDelta.displayQuote, source: "coinbase_crypto_trade" },
    { ...validDelta.displayQuote, priceKind: "quote_midpoint" },
    { ...validDelta.displayQuote, changePercent: "2" },
  ]) {
    assert.equal(validMarketChartDeltaResponse({
      ...validDelta,
      displayQuote,
    }, request), false);
  }

  const futureAt = new Date(Date.now() + 60_000).toISOString();
  const futureDelta = delta(futureAt, 101);
  futureDelta.sessionAuthority = resolveMarketChartSessionAuthority({
    providerTimestamp: futureAt,
    displayedSessionDate: futureDelta.sessionAuthority.displayedSessionDate,
    sessionScope: "extended",
  });
  assert.equal(validMarketChartDeltaResponse(futureDelta, {
    ...request,
    displayedSessionDate: futureDelta.sessionAuthority.displayedSessionDate,
  }), false);

  const validBootstrap = bootstrap();
  assert.equal(validMarketChartBootstrapResponse({
    ...validBootstrap,
    displayQuote: { ...validBootstrap.displayQuote!, live: "false" },
  }, request), false);
});

test("runtime contracts reject dishonest provider-request receipts", () => {
  const validDelta = delta("2026-09-08T14:01:20.000Z", 101);
  const dishonest = {
    ...validDelta,
    instrumentation: {
      ...validDelta.instrumentation,
      providerRequestCount: 1,
    },
  };
  assert.equal(validMarketChartDeltaResponse(dishonest, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }), false);
});

test("runtime contracts reject bars beyond the immutable provider frame", () => {
  const malformed = delta("2026-09-08T14:01:20.000Z", 101);
  malformed.bars = [{
    time: Date.parse("2026-09-08T14:02:00.000Z") / 1_000,
    open: 200,
    high: 200,
    low: 200,
    close: 200,
    volume: 1,
  }];
  malformed.latestAt = "2026-09-08T14:02:00.000Z";
  assert.equal(validMarketChartDeltaResponse(malformed, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "extended",
    displayedSessionDate: "2026-09-08",
  }), false);
});

test("regular-session deltas reject extended-hours bars at both boundaries", () => {
  const providerTimestamp = "2026-09-04T20:01:20.000Z";
  const malformed = delta(providerTimestamp, 101);
  malformed.sessionAuthority = resolveMarketChartSessionAuthority({
    providerTimestamp,
    displayedSessionDate: "2026-09-04",
    sessionScope: "regular",
  });

  assert.equal(validMarketChartDeltaResponse(malformed, {
    asset: "stock",
    symbol: "SPY",
    sessionScope: "regular",
    displayedSessionDate: "2026-09-04",
  }), false);

  const boundaryBars = [
    "2026-09-04T13:29:00.000Z",
    "2026-09-04T13:30:00.000Z",
    "2026-09-04T19:59:00.000Z",
    "2026-09-04T20:00:00.000Z",
    "2026-09-03T15:00:00.000Z",
  ].map((time) => ({
    time: Date.parse(time) / 1_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
  assert.deepEqual(
    marketChartBarsInDisplayedSession(
      boundaryBars,
      "2026-09-04",
      "regular",
    ).map((bar) => new Date(bar.time * 1_000).toISOString()),
    ["2026-09-04T13:30:00.000Z", "2026-09-04T19:59:00.000Z"],
  );
});

test("second aggregate windows begin on a full minute boundary", () => {
  const now = Date.parse("2026-09-08T14:02:05.456Z");
  assert.equal(
    new Date(marketChartSecondAggregateWindowStart(now, 2)).toISOString(),
    "2026-09-08T14:01:00.000Z",
  );
  assert.equal(
    new Date(marketChartSecondAggregateWindowStart(now, 15)).toISOString(),
    "2026-09-08T13:48:00.000Z",
  );
  assert.throws(
    () => marketChartSecondAggregateWindowStart(now, 0),
    RangeError,
  );
});

test("second aggregates are clipped to the exact provider-time frame", () => {
  const base = Date.parse("2026-09-08T14:02:00.000Z") / 1_000;
  const bars = [0, 4, 5, 6].map((offset) => ({
    time: base + offset,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }));
  assert.deepEqual(
    marketBarsAtOrBeforeProviderTimestamp(
      bars,
      "2026-09-08T14:02:05.456Z",
    ).map((bar) => bar.time),
    [base, base + 4],
  );
  assert.deepEqual(marketBarsAtOrBeforeProviderTimestamp(bars, null), []);
});

test("minute aggregates newer than the immutable provider frame stay excluded", () => {
  const minute = Date.parse("2026-09-08T14:02:00.000Z") / 1_000;
  const bars = [minute - 60, minute].map((time) => ({
    time,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
  assert.deepEqual(
    marketBarsAtOrBeforeProviderTimestamp(
      bars,
      "2026-09-08T14:02:05.456Z",
      60,
    ).map((bar) => bar.time),
    [minute - 60],
  );
});

test("cumulative receipts quantify provider-request reduction", () => {
  let frame = marketChartFeedFrameFromBootstrap(bootstrap());
  for (let index = 1; index <= 12; index += 1) {
    frame = mergeMarketChartFeedDelta(
      frame,
      delta(`2026-09-08T14:${String(index).padStart(2, "0")}:20.000Z`, 100 + index),
    );
  }
  assert.deepEqual(summarizeMarketChartFeedEfficiency(frame), {
    observedProviderRequests: 28,
    acceptedEvidenceCount: 28,
    reusedEvidenceCount: 0,
    comparablePollingFrames: 13,
    modeledLegacyRequests: 52,
    modeledSavedRequests: 24,
    reductionPercent: 46.2,
  });
});
