import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { selectLocalStockDisplayFrame, stockDisplayFrameBucket } from "./stock-display-frame-server.ts";

const trade = (symbol: string, price: number, asOf: number, frameBucket: number) => ({
  symbol,
  price,
  asOf: new Date(asOf).toISOString(),
  source: "massive_polygon_last_trade" as const,
  priceKind: "trade" as const,
  size: 10,
  frameBucket,
});

test("one presentation bucket keeps one exact price across callers", () => {
  const now = Date.now();
  const bucket = stockDisplayFrameBucket(now);
  const first = selectLocalStockDisplayFrame(trade("SYNC1", 7.555, now - 300, bucket));
  const second = selectLocalStockDisplayFrame(trade("SYNC1", 7.5369, now - 100, bucket));
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(second?.price, 7.555);
  assert.equal(second?.frameId, `stock-display-frame-v1:SYNC1:${bucket}`);
});

test("the database winner replaces a provisional instance value in the same bucket", () => {
  const now = Date.now();
  const bucket = stockDisplayFrameBucket(now);
  const provisional = selectLocalStockDisplayFrame(trade("SYNCDB", 9.71, now - 100, bucket));
  const databaseWinner = selectLocalStockDisplayFrame(
    trade("SYNCDB", 9.6954, now - 300, bucket),
    "database",
  );
  assert.equal(provisional?.coordination, "instance_fallback");
  assert.equal(databaseWinner?.price, 9.6954);
  assert.equal(databaseWinner?.coordination, "database");
  assert.equal(databaseWinner?.frameId, provisional?.frameId);
});

test("new buckets advance without allowing late responses to regress provider time", () => {
  const now = Date.now();
  const bucket = stockDisplayFrameBucket(now);
  const first = selectLocalStockDisplayFrame(trade("SYNC2", 10, now - 100, bucket));
  const advanced = selectLocalStockDisplayFrame(trade("SYNC2", 11, now, bucket + 5_000));
  const late = selectLocalStockDisplayFrame(trade("SYNC2", 9, now - 1_000, bucket));
  assert.equal(first?.price, 10);
  assert.equal(advanced?.price, 11);
  assert.deepEqual(late, advanced);

  const staleNextBucket = selectLocalStockDisplayFrame(trade("SYNC2", 8, now - 2_000, bucket + 10_000));
  assert.equal(staleNextBucket?.price, 11);
  assert.equal(staleNextBucket?.asOf, advanced?.asOf);
  assert.equal(staleNextBucket?.frameBucket, bucket + 10_000);
});
