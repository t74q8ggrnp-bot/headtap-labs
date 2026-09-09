import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { alignedMarketChartPollDelay, createMarketChartPollAttemptGate, createServerAnchoredClock, knownUsStockMarketEarlyClose, knownUsStockMarketHoliday, marketChartBootstrapRetryDelay, marketChartFailureBackoffMs, marketChartHistoryLabel, marketChartPollingState, marketChartProviderCallBudget, marketChartRolloverBootstrapDelay, marketChartSessionRolloverRequired, parseRetryAfterMs, providerResponseRequiresBackoff } from "./market-chart-polling.ts";

test("server receipts replace device wall-clock authority with monotonic elapsed time", () => {
  let deviceNow = Date.parse("2034-01-01T00:00:00Z");
  let monotonicNow = 500;
  const clock = createServerAnchoredClock({
    deviceNow: () => deviceNow,
    monotonicNow: () => monotonicNow,
  });
  assert.equal(clock.now(), deviceNow);
  assert.equal(clock.anchored, false);
  assert.equal(clock.accept("2026-09-08T13:29:55.000Z"), true);
  assert.equal(clock.anchored, true);
  assert.equal(clock.now(), Date.parse("2026-09-08T13:29:55.000Z"));

  deviceNow = Date.parse("1999-01-01T00:00:00Z");
  monotonicNow += 5_000;
  assert.equal(clock.now(), Date.parse("2026-09-08T13:30:00.000Z"));
  assert.equal(marketChartPollingState(new Date(clock.now())).active, true);

  // A delayed response can refine the anchor, but never move it backward.
  assert.equal(clock.accept("2026-09-08T13:29:58.000Z"), true);
  assert.equal(clock.now(), Date.parse("2026-09-08T13:30:00.000Z"));
  assert.equal(clock.accept("not-a-time"), false);
});

test("workspace polling is active only during the requested stock session", () => {
  assert.equal(marketChartPollingState(new Date("2026-09-08T13:00:00Z"), "extended").active, true);
  assert.equal(marketChartPollingState(new Date("2026-09-08T13:00:00Z"), "regular").active, false);
  assert.equal(marketChartPollingState(new Date("2026-09-08T15:00:00Z"), "regular").active, true);
  assert.equal(marketChartPollingState(new Date("2026-09-08T21:00:00Z"), "extended").active, true);
  assert.equal(marketChartPollingState(new Date("2026-09-09T01:00:00Z"), "extended").active, false);
});

test("weekends and known full-day market holidays never authorize delta polling", () => {
  assert.equal(marketChartPollingState(new Date("2026-09-12T15:00:00Z"), "extended").reason, "weekend");
  assert.equal(knownUsStockMarketHoliday("2026-09-07"), true);
  assert.equal(marketChartPollingState(new Date("2026-09-07T15:00:00Z"), "extended").reason, "market_holiday");
  assert.equal(knownUsStockMarketHoliday("2026-12-25"), true);
  assert.equal(knownUsStockMarketHoliday("2027-12-31"), false);
  assert.equal(knownUsStockMarketHoliday("2028-01-01"), false);
});

test("published NYSE early closes stop regular and extended delta polling on time", () => {
  assert.equal(knownUsStockMarketEarlyClose("2026-11-27"), true);
  assert.equal(marketChartPollingState(new Date("2026-11-27T17:59:00Z"), "regular").active, true);
  assert.equal(marketChartPollingState(new Date("2026-11-27T18:00:00Z"), "regular").reason, "early_close");
  assert.equal(marketChartPollingState(new Date("2026-11-27T21:59:00Z"), "extended").active, true);
  assert.equal(marketChartPollingState(new Date("2026-11-27T23:00:00Z"), "extended").active, true);
  assert.equal(marketChartPollingState(new Date("2026-11-28T01:00:00Z"), "extended").reason, "early_close");
});

test("presentation labels cannot call holiday or post-early-close prints Live", () => {
  assert.equal(
    marketChartHistoryLabel(
      "2026-09-07T15:00:00Z",
      new Date("2026-09-07T15:00:01Z"),
    ),
    "Last session · 2026-09-07",
  );
  assert.equal(
    marketChartHistoryLabel(
      "2026-11-27T22:00:00Z",
      new Date("2026-11-28T01:00:01Z"),
    ),
    "Last session · 2026-11-27",
  );
});

test("an active new session is detected before a stale-session delta spends provider calls", () => {
  assert.equal(marketChartSessionRolloverRequired({
    displayedSessionDate: "2026-09-07",
    now: new Date("2026-09-08T13:00:00Z"),
  }), true);
  assert.equal(marketChartSessionRolloverRequired({
    displayedSessionDate: "2026-09-08",
    now: new Date("2026-09-08T13:00:00Z"),
  }), false);
  assert.equal(marketChartSessionRolloverRequired({
    displayedSessionDate: "2026-09-11",
    now: new Date("2026-09-12T15:00:00Z"),
  }), false);
});

test("a prior-session bootstrap is rechecked at most once per inactive minute", () => {
  const firstBootstrapAt = Date.parse("2026-09-08T08:00:00Z");
  assert.equal(marketChartRolloverBootstrapDelay(0, firstBootstrapAt), 0);
  assert.equal(
    marketChartRolloverBootstrapDelay(firstBootstrapAt, firstBootstrapAt + 5_000),
    55_000,
  );
  assert.equal(
    marketChartRolloverBootstrapDelay(firstBootstrapAt, firstBootstrapAt + 59_999),
    1,
  );
  assert.equal(
    marketChartRolloverBootstrapDelay(firstBootstrapAt, firstBootstrapAt + 60_000),
    0,
  );
});

test("delta failures back off exponentially with bounded jitter and resettable attempts", () => {
  assert.equal(marketChartFailureBackoffMs({ attempt: 1, random: () => 0.5 }), 5_000);
  assert.equal(marketChartFailureBackoffMs({ attempt: 2, random: () => 0.5 }), 10_000);
  assert.equal(marketChartFailureBackoffMs({ attempt: 3, random: () => 0.5 }), 20_000);
  assert.equal(marketChartFailureBackoffMs({ attempt: 10, random: () => 0.5 }), 60_000);
  assert.equal(marketChartFailureBackoffMs({ attempt: 10, random: () => 1 }), 60_000);
  assert.equal(marketChartFailureBackoffMs({ attempt: 2, random: () => 0 }), 8_000);
  assert.equal(marketChartFailureBackoffMs({ attempt: 2, random: () => 1 }), 12_000);
});

test("bootstrap recovery is bounded to one-minute cadence while markets are closed", () => {
  assert.equal(marketChartBootstrapRetryDelay({
    now: new Date("2026-09-08T15:00:00Z"),
    sessionScope: "extended",
    backoffMs: 5_000,
  }), 5_000);
  assert.equal(marketChartBootstrapRetryDelay({
    now: new Date("2026-09-08T02:00:00Z"),
    sessionScope: "extended",
    backoffMs: 5_000,
  }), 60_000);
  assert.equal(marketChartBootstrapRetryDelay({
    now: new Date("2026-09-12T15:00:00Z"),
    sessionScope: "extended",
    backoffMs: 120_000,
  }), 120_000);
});

test("poll attempt gate prevents overlap and preserves retry deadlines", () => {
  let now = 1_000;
  const gate = createMarketChartPollAttemptGate(() => now);
  assert.equal(gate.start(), true);
  assert.equal(gate.start(), false);
  gate.fail(30_000);
  assert.equal(gate.delay(250), 30_000);
  assert.equal(gate.start(), false);
  now += 29_000;
  assert.equal(gate.delay(250), 1_000);
  assert.equal(gate.start(), false);
  now += 1_000;
  assert.equal(gate.start(), true);
  gate.succeed(5_000);
  assert.equal(gate.delay(250), 5_000);
  assert.equal(gate.start(), false);
  now += 5_000;
  assert.equal(gate.start(), true);
  gate.succeed();
  assert.equal(gate.delay(250), 250);
});

test("Retry-After seconds or HTTP dates take precedence over local backoff", () => {
  const now = Date.parse("2026-09-08T14:00:00Z");
  assert.equal(parseRetryAfterMs("45", now), 45_000);
  assert.equal(parseRetryAfterMs("Tue, 08 Sep 2026 14:02:00 GMT", now), 120_000);
  assert.equal(parseRetryAfterMs("nonsense", now), null);
  assert.equal(marketChartFailureBackoffMs({
    attempt: 1,
    retryAfterMs: 45_000,
    random: () => 0.5,
  }), 45_000);
  assert.equal(providerResponseRequiresBackoff(429, null), true);
  assert.equal(providerResponseRequiresBackoff(503, null), true);
  assert.equal(providerResponseRequiresBackoff(502, "20"), true);
  assert.equal(providerResponseRequiresBackoff(502, null), false);
});

test("poll alignment and provider-call budgets are explicit", () => {
  assert.equal(alignedMarketChartPollDelay(12_345, 5_000), 2_655);
  assert.deepEqual(marketChartProviderCallBudget({ active: true, includeBootstrap: true }), {
    bootstrapCalls: 4,
    deltaPollsPerMinute: 12,
    deltaCallsPerMinute: 24,
    totalCalls: 28,
  });
  assert.deepEqual(marketChartProviderCallBudget({ active: false }), {
    bootstrapCalls: 0,
    deltaPollsPerMinute: 0,
    deltaCallsPerMinute: 0,
    totalCalls: 0,
  });
});
