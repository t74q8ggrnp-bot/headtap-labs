import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { summarizeIntradaySessionBars } from "./intraday-session-bars.ts";

test("hydrates premarket open, high, low, volume, and provider timestamp", () => {
  const result = summarizeIntradaySessionBars(
    [
      {
        open: 0.45,
        high: 0.52,
        low: 0.43,
        close: 0.50,
        volume: 10_000,
        timestamp: Date.parse("2026-08-31T12:00:00.000Z"),
      },
      {
        open: 0.50,
        high: 0.58,
        low: 0.48,
        close: 0.56,
        volume: 15_000,
        timestamp: Date.parse("2026-08-31T12:01:00.000Z"),
      },
    ],
    "pre_market",
  );
  assert.ok(result);
  assert.equal(result.sessionOpenPrice, 0.45);
  assert.equal(result.sessionHighPrice, 0.58);
  assert.equal(result.sessionLowPrice, 0.43);
  assert.equal(result.currentVolume, 25_000);
  assert.equal(result.price, 0.56);
  assert.equal(result.latestBarAt, "2026-08-31T12:01:00.000Z");
});
