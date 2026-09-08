import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { parseStockDisplayFrame, publishStockDisplayFrame, selectLocalStockDisplayFrame, StockDisplayFrameCoordinationError, stockDisplayFrameBucket } from "./stock-display-frame-server.ts";

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

test("database timestamptz offsets normalize to the canonical provider clock", () => {
  const now = Date.now();
  const bucket = stockDisplayFrameBucket(now);
  const frame = parseStockDisplayFrame({
    symbol: "SYNCTZ",
    price: 7.555,
    asOf: new Date(now - 500).toISOString().replace("Z", "+00:00"),
    source: "massive_polygon_last_trade",
    priceKind: "trade",
    size: 10,
    frameBucket: bucket,
    frameId: `stock-display-frame-v1:SYNCTZ:${bucket}`,
    frameVersion: "stock-display-frame-v1",
  });
  assert.ok(frame);
  assert.equal(frame.asOf, new Date(now - 500).toISOString());
});

test("shared publication fails closed when database coordination is unavailable", async () => {
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const priorServiceKey = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;

  try {
    const now = Date.now();
    await assert.rejects(
      publishStockDisplayFrame("SYNCFAIL", {
        price: 7.555,
        asOf: new Date(now - 250).toISOString(),
        source: "massive_polygon_last_trade",
        priceKind: "trade",
        size: 10,
      }, now),
      (error: unknown) =>
        error instanceof StockDisplayFrameCoordinationError &&
        error.issue === "not_configured",
    );
  } finally {
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = priorServiceRoleKey;
    if (priorServiceKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = priorServiceKey;
  }
});
