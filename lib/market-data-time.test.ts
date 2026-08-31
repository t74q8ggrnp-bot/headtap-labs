import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { buildMarketDataTimingReceipt, getMarketDataAgeMs, isActiveMarketTimestampUsable, measureMarketTimestampAlignment } from "./market-data-time.ts";

test("market freshness is measured from the provider timestamp", () => {
  const now = new Date("2026-08-28T17:30:00.000Z");
  assert.equal(
    getMarketDataAgeMs("2026-08-28T17:14:00.000Z", now),
    16 * 60 * 1000,
  );
  assert.equal(
    isActiveMarketTimestampUsable("2026-08-28T17:26:00.000Z", now),
    true,
  );
  assert.equal(
    isActiveMarketTimestampUsable("2026-08-28T17:24:59.000Z", now),
    false,
  );
});

test("canonical and ProX evidence must describe the same market moment", () => {
  const aligned = measureMarketTimestampAlignment(
    "2026-08-28T17:14:00.000Z",
    "2026-08-28T17:12:00.000Z",
  );
  const misaligned = measureMarketTimestampAlignment(
    "2026-08-28T17:14:00.000Z",
    "2026-08-28T17:11:00.000Z",
  );
  assert.equal(aligned.aligned, true);
  assert.equal(misaligned.aligned, false);
  assert.equal(misaligned.skewMs, 3 * 60 * 1000);
});

test("market observations retain provider, receipt, and processing clocks", () => {
  const receipt = buildMarketDataTimingReceipt({
    marketAsOf: "2026-08-31T13:30:00.000Z",
    receivedAt: new Date("2026-08-31T13:30:01.000Z"),
    processedAt: new Date("2026-08-31T13:30:01.250Z"),
  });
  assert.equal(receipt.dataAgeMs, 1_250);
  assert.equal(receipt.processingLatencyMs, 250);
  assert.equal(receipt.marketAsOf, "2026-08-31T13:30:00.000Z");
});
