export const HT_RUNTIME_CONTRACT_VERSION = "ht-runtime-capabilities-v7-agent-x-visual-plan-release";

export const HT_REQUIRED_MIGRATIONS = Object.freeze([
  "0024_manual_paper_trading.sql",
  "0025_prox_shadow_episode_scorecard.sql",
  "0026_market_data_timestamp_authority.sql",
  "0027_prox_realtime_microstructure_observations.sql",
  "0028_paper_match_health.sql",
  "0048_shared_stock_display_frames.sql",
  "0049_secure_ht_labs_watchlist.sql",
  "0050_phase1_workspace_infrastructure_verification.sql",
  "0052_agent_x_visual_paper_plans.sql",
  "0053_agent_x_visual_plan_verification.sql",
  "0054_agent_x_visual_plan_release_contract.sql",
  "0055_agent_x_visual_plan_internal_visible.sql",
]);

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
    coordination: "database_required",
    unavailableFallback: "none",
    coordinationFailureBehavior: "fail_closed",
  }),
});
