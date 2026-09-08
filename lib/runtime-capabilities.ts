export const HT_RUNTIME_CONTRACT_VERSION = "ht-runtime-capabilities-v2-shared-display-frame";

export const HT_REFRESH_RATES_MS = Object.freeze({
  canonicalScan: 120_000,
  proxSensing: 60_000,
  homeDecisions: 30_000,
  selectedQuotes: 5_000,
  selectedStockCharts: 5_000,
});

export const HT_MARKET_DATA_AUTHORITY = Object.freeze({
  provider: "massive_polygon",
  freshnessTimestamp: "provider_market_time",
  processingTimestampsAreFreshnessAuthority: false,
  closedMarketMayBeLabeledLive: false,
  displayFrame: Object.freeze({
    version: "stock-display-frame-v1",
    intervalMs: 5_000,
    scope: "presentation_only",
    sharedAcrossDesktopMobileChartsAndQuotes: true,
    requiredMigration: "0048_shared_stock_display_frames.sql",
    unavailableFallback: "same_server_instance_only",
  }),
});
