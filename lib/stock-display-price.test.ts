import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error strip-types runner
import { resolveStockDisplayPrice } from "./stock-display-price.ts";
// @ts-expect-error strip-types runner
import { resolveSnapshotDisplayPrice } from "./polygon-snapshot.ts";
import type { PolygonSnapshotRow } from "./polygon-snapshot.ts";
import type { MassiveLastTrade } from "./massive-stocks.ts";

const NOW = Date.parse("2026-09-03T13:42:48Z");
const tradeAt = NOW - 875;
const fixture = (): PolygonSnapshotRow => ({ ticker: "CHPT", prevDay: { c: 5.19 },
  day: { o: 6.9, h: 7.75, l: 6.71, c: 7.58 }, min: { c: 7.58, t: NOW - 108_000 },
  lastTrade: { p: 7.64, t: tradeAt * 1e6 } });
const direct = (price: number, at: number): MassiveLastTrade => ({ price,
  timestamp: new Date(at).toISOString(), size: 100 });

test("CHPT display uses its latest trade even above 35% from the reference; Canonical is unchanged", () => {
  const row = fixture();
  assert.equal(resolveSnapshotDisplayPrice(row, new Date(NOW)), 7.58);
  assert.deepEqual(resolveStockDisplayPrice(row, null, NOW), {
    price: 7.64, asOf: new Date(tradeAt).toISOString(), priceKind: "trade",
    source: "massive_polygon_snapshot", size: null,
  });
  assert.equal(resolveSnapshotDisplayPrice(row, new Date(NOW)), 7.58);
});

test("direct and snapshot trades are compared by provider clock, never fetch completion time", () => {
  const row = fixture();
  const earlier = direct(7.555, tradeAt - 1000);
  const later = direct(7.6497, tradeAt + 500);
  assert.equal(resolveStockDisplayPrice(row, earlier, NOW)!.price, 7.64);
  assert.equal(resolveStockDisplayPrice(row, later, NOW)!.price, 7.6497);
  assert.equal(resolveStockDisplayPrice(row, later, NOW)!.asOf, later.timestamp);
});

test("undated aggregate closes never borrow the latest trade clock", () => {
  const row = fixture(); row.lastTrade!.p = 0; row.min!.t = undefined;
  assert.equal(resolveStockDisplayPrice(row, null, NOW), null);
  row.lastTrade!.p = 7.64; row.lastTrade!.t = undefined;
  assert.equal(resolveStockDisplayPrice(row, null, NOW), null);
});

test("future and invalid trade prices fall back to their own minute observation, not the future clock", () => {
  for (const trade of [{ p: 8, t: (NOW + 3000) * 1e6 }, { p: NaN, t: tradeAt * 1e6 },
    { p: -1, t: tradeAt * 1e6 }]) {
    const row = fixture(); row.lastTrade = trade;
    const value = resolveStockDisplayPrice(row, null, NOW)!;
    assert.equal(value.price, 7.58); assert.equal(value.asOf, new Date(NOW - 108_000).toISOString());
    assert.equal(value.priceKind, "minute_aggregate");
  }
});

test("a newer minute close stays identified as an aggregate; old session timestamps are preserved", () => {
  const row = fixture(); row.lastTrade!.t = (NOW - 3 * 60_000) * 1e6;
  assert.equal(resolveStockDisplayPrice(row, null, NOW)!.priceKind, "minute_aggregate");
  const retained = direct(7.5369, NOW - 24 * 60 * 60_000);
  assert.equal(resolveStockDisplayPrice(null, retained, NOW)!.asOf, retained.timestamp);
  assert.equal(resolveStockDisplayPrice(null, null, NOW), null);
});

test("milliseconds, microseconds and nanoseconds retain the same provider observation", () => {
  for (const scale of [1, 1000, 1e6]) {
    const row = fixture(); row.lastTrade!.t = tradeAt * scale;
    assert.equal(resolveStockDisplayPrice(row, null, NOW)!.asOf, new Date(tradeAt).toISOString());
  }
});
