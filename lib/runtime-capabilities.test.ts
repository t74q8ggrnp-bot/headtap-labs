import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_MARKET_DATA_AUTHORITY, HT_REFRESH_RATES_MS, HT_REQUIRED_MIGRATIONS, HT_RUNTIME_CONTRACT_VERSION } from "./runtime-capabilities.ts";

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
  assert.equal(
    HT_RUNTIME_CONTRACT_VERSION,
    "ht-runtime-capabilities-v4-crypto-shelved",
  );
  assert.equal(HT_MARKET_DATA_AUTHORITY.freshnessTimestamp, "provider_market_time");
  assert.equal(HT_MARKET_DATA_AUTHORITY.processingTimestampsAreFreshnessAuthority, false);
  assert.equal(HT_MARKET_DATA_AUTHORITY.closedMarketMayBeLabeledLive, false);
  assert.deepEqual(HT_MARKET_DATA_AUTHORITY.displayFrame, {
    version: "stock-display-frame-v1",
    intervalMs: 5_000,
    scope: "presentation_only",
    sharedAcrossDesktopMobileChartsAndQuotes: true,
    requiredMigration: "0048_shared_stock_display_frames.sql",
    coordination: "database_required",
    unavailableFallback: "none",
    coordinationFailureBehavior: "fail_closed",
  });
});

test("publishes every migration required by the native runtime contract", () => {
  assert.deepEqual(HT_REQUIRED_MIGRATIONS, [
    "0024_manual_paper_trading.sql",
    "0025_prox_shadow_episode_scorecard.sql",
    "0026_market_data_timestamp_authority.sql",
    "0027_prox_realtime_microstructure_observations.sql",
    "0028_paper_match_health.sql",
    "0048_shared_stock_display_frames.sql",
    "0049_secure_ht_labs_watchlist.sql",
  ]);
});
