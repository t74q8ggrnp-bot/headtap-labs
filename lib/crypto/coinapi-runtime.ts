import { isCryptoCapabilityEnabled } from "./product-capabilities";

/**
 * Owner-approved temporary cost isolation.
 *
 * Keep this code-owned so an old Vercel cron or an accidentally retained
 * environment flag cannot resume provider requests. Re-enabling CoinAPI must
 * be an explicit reviewed code change after its request economics are fixed.
 */
export const COINAPI_RESEARCH_RUNTIME = Object.freeze({
  paused: !isCryptoCapabilityEnabled("coinApiResearchCollectionEnabled"),
  reason: "owner_paused_for_cost_and_query_audit_2026_09_08",
  providerRequestsAllowed: isCryptoCapabilityEnabled(
    "coinApiResearchCollectionEnabled",
  ),
  archiveMaintenanceAllowed: isCryptoCapabilityEnabled(
    "coinApiEvidenceMaintenanceEnabled",
  ),
});
