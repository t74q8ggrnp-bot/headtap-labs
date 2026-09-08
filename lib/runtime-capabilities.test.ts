import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_MARKET_DATA_AUTHORITY, HT_REFRESH_RATES_MS } from "./runtime-capabilities.ts";

test("publishes the release-approved stock refresh cadences", () => {
  assert.deepEqual(HT_REFRESH_RATES_MS, {
    canonicalScan: 120_000,
    proxSensing: 60_000,
    homeDecisions: 30_000,
    selectedQuotes: 5_000,
    selectedStockCharts: 5_000,
  });
});

test("keeps provider time authoritative and closed stock data non-live", () => {
  assert.equal(HT_MARKET_DATA_AUTHORITY.freshnessTimestamp, "provider_market_time");
  assert.equal(HT_MARKET_DATA_AUTHORITY.processingTimestampsAreFreshnessAuthority, false);
  assert.equal(HT_MARKET_DATA_AUTHORITY.closedMarketMayBeLabeledLive, false);
  assert.deepEqual(HT_MARKET_DATA_AUTHORITY.displayFrame, {
    version: "stock-display-frame-v1",
    intervalMs: 5_000,
    scope: "presentation_only",
    sharedAcrossDesktopMobileChartsAndQuotes: true,
    requiredMigration: "0048_shared_stock_display_frames.sql",
    unavailableFallback: "same_server_instance_only",
  });
});
