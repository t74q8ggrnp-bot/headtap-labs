import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { MarketProviderCostGuard, marketProviderCoalescingKey, providerTimestampCanEnterShortCache } from "./market-provider-cost-guard.ts";

test("identical concurrent provider work is single-flight", async () => {
  let now = 10_000;
  let loads = 0;
  let release!: (value: string) => void;
  const guard = new MarketProviderCostGuard({ now: () => now });
  const load = () => {
    loads += 1;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  const first = guard.run({ key: "trade:SPY:2", load, cacheIf: () => true });
  const second = guard.run({ key: "trade:SPY:2", load, cacheIf: () => true });
  await Promise.resolve();
  assert.equal(loads, 1);
  release("frame");
  const [origin, joined] = await Promise.all([first, second]);
  assert.equal(origin.value, "frame");
  assert.equal(origin.delivery, "provider");
  assert.equal(origin.providerRequestAttempted, true);
  assert.equal(joined.delivery, "single_flight");
  assert.equal(joined.providerRequestAttempted, false);
  now += 10;
});

test("admitted evidence is reused only inside its short TTL", async () => {
  let now = 50_000;
  let loads = 0;
  const guard = new MarketProviderCostGuard({ ttlMs: 100, now: () => now });
  const run = () => guard.run({
    key: "snapshot:SPY:10",
    load: async () => ++loads,
    cacheIf: () => true,
  });
  assert.equal((await run()).delivery, "provider");
  now += 99;
  const cached = await run();
  assert.equal(cached.delivery, "ttl_cache");
  assert.equal(cached.value, 1);
  assert.equal(cached.evidenceAgeMs, 99);
  now += 1;
  const refreshed = await run();
  assert.equal(refreshed.delivery, "provider");
  assert.equal(refreshed.value, 2);
});

test("errors and evidence rejected by freshness admission are never cached", async () => {
  let loads = 0;
  const guard = new MarketProviderCostGuard();
  await assert.rejects(guard.run({
    key: "bars:bad",
    load: async () => {
      loads += 1;
      throw new Error("provider failed");
    },
    cacheIf: () => true,
  }), /provider failed/);
  await assert.rejects(guard.run({
    key: "bars:bad",
    load: async () => {
      loads += 1;
      throw new Error("provider failed again");
    },
    cacheIf: () => true,
  }), /provider failed again/);
  const stale = () => guard.run({
    key: "bars:stale",
    load: async () => ++loads,
    cacheIf: () => false,
  });
  assert.equal((await stale()).delivery, "provider");
  assert.equal((await stale()).delivery, "provider");
  assert.equal(loads, 4);
  assert.equal(guard.size(), 0);
});

test("the cache stays bounded without evicting live single-flight work", async () => {
  const guard = new MarketProviderCostGuard({ maxEntries: 1 });
  let release!: () => void;
  const first = guard.run({
    key: "first",
    load: () => new Promise<string>((resolve) => {
      release = () => resolve("one");
    }),
    cacheIf: () => true,
  });
  await Promise.resolve();
  const second = await guard.run({
    key: "second",
    load: async () => "two",
    cacheIf: () => true,
  });
  assert.equal(second.delivery, "provider");
  assert.equal(guard.size(), 1);
  release();
  await first;
  assert.equal(guard.size(), 1);
});

test("coalescing keys never include credentials and rotate every five seconds", () => {
  const first = marketProviderCoalescingKey({
    operation: "Last Trade",
    symbol: "spy",
    timestampMs: 9_999,
    variant: "extended",
  });
  const next = marketProviderCoalescingKey({
    operation: "Last Trade",
    symbol: "SPY",
    timestampMs: 10_000,
    variant: "extended",
  });
  assert.equal(first, "last trade:SPY:extended:1");
  assert.equal(next, "last trade:SPY:extended:2");
  assert.equal(first.includes("apiKey"), false);
  assert.notEqual(first, next);
});

test("active-session stale or future provider evidence never enters cache", () => {
  const completedAt = Date.parse("2026-09-08T14:00:30.000Z");
  assert.equal(providerTimestampCanEnterShortCache({
    providerTimestamp: "2026-09-08T14:00:05.000Z",
    completedAt,
    activeSession: true,
    maxAgeMs: 30_000,
  }), true);
  assert.equal(providerTimestampCanEnterShortCache({
    providerTimestamp: "2026-09-08T13:59:59.000Z",
    completedAt,
    activeSession: true,
    maxAgeMs: 30_000,
  }), false);
  assert.equal(providerTimestampCanEnterShortCache({
    providerTimestamp: "2026-09-08T14:00:33.000Z",
    completedAt,
    activeSession: true,
    maxAgeMs: 30_000,
  }), false);
  assert.equal(providerTimestampCanEnterShortCache({
    providerTimestamp: "2026-09-05T19:59:59.000Z",
    completedAt,
    activeSession: false,
    maxAgeMs: 30_000,
  }), true);
});
