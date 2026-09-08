/** The old ledgers lack per-horizon provider evidence. Never use them to train. */
export function legacyCryptoOutcomeQuarantine() {
  return {
    version: "crypto-outcome-integrity-v2" as const,
    status: "quarantined" as const,
    reason: "legacy_entry_and_horizon_provider_times_unverified",
    evaluationEligible: false as const,
    outcomesUpdated: 0,
    outcomesUnavailable: 0,
    // Unavailable count cannot be inferred without auditing individual records.
    auditedLegacyRows: null,
    historicalPricesReconstructed: false as const,
  };
}

export function isVerifiedCryptoOutcomeSource(source: string) {
  return source === "coinapi-provider-book-ledger-v1";
}
/** Migration 0037 makes these nullable. Observations continue; invalid legacy
 * outcome promises do not. All verified horizons belong to the CoinAPI ledger. */
export function legacyCryptoObservationOnly() {
  return {
    outcome_tracking_status: "not_scheduled" as const,
    target_15m_at: null,
    target_1h_at: null,
    target_4h_at: null,
    target_24h_at: null,
  };
}
