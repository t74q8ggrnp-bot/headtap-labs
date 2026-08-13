export const PROX_PUBLIC_AUTHORITY_VERSION =
  "prox-public-market-authority-v2";

export const PROX_PUBLIC_AUTHORITY_CONTRACT = {
  version: PROX_PUBLIC_AUTHORITY_VERSION,
  marketPulse: "bounded_rank_and_peak_failure" as const,
  eventEvidence: "explanation_and_research_only" as const,
  transitionEvidence: "comparison_research_only" as const,
  publicScore: "single_canonical_ht_score" as const,
  execution: "none" as const,
  liveTrading: "disabled" as const,
  maximumSupportAdjustment: 12,
  maximumOrdinaryPenalty: -12,
  confirmedPeakFailure: "canonical_eligibility_block" as const,
  deepSessionRecovery: "canonical_entry_withheld_until_reclaim" as const,
} as const;

type ProxAuthorityPulse = {
  fresh: boolean;
  state: "expanding" | "stable" | "weakening" | "stale";
  peakFailureConfirmed: boolean;
  peakFailureThresholdPercent: number;
  pullbackFromWindowHighPercent: number | null;
  velocity1m: number | null;
  acceleration5m: number | null;
  volumeAcceleration: number | null;
  priceVsVwap: number | null;
  averageBarRangePercent: number | null;
};

export type ProxPublicAuthorityDecision = {
  authorityVersion: typeof PROX_PUBLIC_AUTHORITY_VERSION;
  marketConfirmation: number | null;
  structuralRecoveryThresholdPercent: number;
  livePeakFailureEvidence: number;
  observedPeakPullbackPercent: number;
  peakFailureConfirmed: boolean;
  deepSessionRecoveryWithheld: boolean;
  supportsContinuation: boolean;
  rankAdjustment: number;
};

export function evaluateProxPublicAuthority(input: {
  activeMarketSession: boolean;
  marketConfirmation: number | null;
  sessionPeakPullbackPercent: number | null;
  activeSessionChangePercent: number | null;
  pulse: ProxAuthorityPulse | null | undefined;
}): ProxPublicAuthorityDecision {
  const pulse = input.pulse;
  const marketConfirmation =
    pulse?.fresh === true && Number.isFinite(input.marketConfirmation)
      ? input.marketConfirmation
      : null;
  const livePeakFailureEvidence = [
    (pulse?.velocity1m ?? 0) <= -0.75,
    (pulse?.acceleration5m ?? 0) <= -1.5,
    (pulse?.priceVsVwap ?? 0) <= -0.75,
    (pulse?.volumeAcceleration ?? 0) >= 1.1 &&
      (pulse?.velocity1m ?? 0) < 0,
  ].filter(Boolean).length;
  const observedPeakPullbackPercent = Math.max(
    input.sessionPeakPullbackPercent ?? 0,
    pulse?.pullbackFromWindowHighPercent ?? 0,
  );
  const peakFailureConfirmed = Boolean(
    pulse?.fresh === true &&
      (pulse.peakFailureConfirmed ||
        ((input.sessionPeakPullbackPercent ?? 0) >=
          pulse.peakFailureThresholdPercent &&
          livePeakFailureEvidence >= 2)),
  );
  const structuralRecoveryThresholdPercent = Math.max(
    20,
    Math.min(35, (pulse?.averageBarRangePercent ?? 0) * 4),
  );
  const deepSessionRecoveryWithheld = Boolean(
    pulse?.fresh === true &&
      !peakFailureConfirmed &&
      (input.sessionPeakPullbackPercent ?? 0) >=
        structuralRecoveryThresholdPercent &&
      input.activeSessionChangePercent !== null &&
      input.activeSessionChangePercent <= -5,
  );
  const supportsContinuation = Boolean(
    pulse?.fresh === true &&
      !peakFailureConfirmed &&
      !deepSessionRecoveryWithheld &&
      marketConfirmation !== null &&
      marketConfirmation >= 55 &&
      (pulse.state === "expanding" || pulse.state === "stable"),
  );
  const rankAdjustment = peakFailureConfirmed
    ? -Math.min(30, 15 + Math.round(observedPeakPullbackPercent))
    : deepSessionRecoveryWithheld
      ? PROX_PUBLIC_AUTHORITY_CONTRACT.maximumOrdinaryPenalty
    : marketConfirmation === null
      ? input.activeMarketSession
        ? -8
        : 0
      : marketConfirmation >= 75
        ? Math.min(
            PROX_PUBLIC_AUTHORITY_CONTRACT.maximumSupportAdjustment,
            7 + Math.round((marketConfirmation - 75) / 5),
          )
        : marketConfirmation >= 65
          ? 5
          : marketConfirmation < 35
            ? PROX_PUBLIC_AUTHORITY_CONTRACT.maximumOrdinaryPenalty
            : marketConfirmation < 45
              ? -6
              : 0;

  return {
    authorityVersion: PROX_PUBLIC_AUTHORITY_VERSION,
    marketConfirmation,
    structuralRecoveryThresholdPercent,
    livePeakFailureEvidence,
    observedPeakPullbackPercent,
    peakFailureConfirmed,
    deepSessionRecoveryWithheld,
    supportsContinuation,
    rankAdjustment,
  };
}
