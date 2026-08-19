export const POSITIVE_FULL_DAY_MOMENTUM_REQUIRED =
  "Spot Momentum requires positive movement versus the previous close.";

export const PROX_PEAK_FAILURE_BLOCK =
  "ProX confirms post-peak deterioration.";

export const PRICE_DISCOVERY_SCENARIO_RR_FLOOR = 1;
export const PRICE_DISCOVERY_SCENARIO_RR_PREFIX =
  "Price discovery scenario R:R";

export function getPriceDiscoveryEntryRejection(assessment: {
  state?: unknown;
  scenarioBands?: { expansionRr?: unknown } | null;
}) {
  if (assessment.state !== "price_discovery") return null;
  // A missing ratio and a bad ratio are different things. expansionRr is
  // null specifically when framework.downsideRisk isn't available yet (a
  // genuine breakout that blew past the historical-deviation check before a
  // support level was ever computed) — that's "unknown," not "bad," and it's
  // disproportionately the biggest, most extended, most confirmed movers
  // that end up in this state. Only a real, computed ratio that's actually
  // below the floor should block entry; an unmeasurable one should not.
  if (assessment.scenarioBands == null) return null;
  // Number(null) is 0, not NaN — check for null/undefined explicitly rather
  // than relying on the scenarioRr <= 0 branch below to happen to catch it.
  const rawExpansionRr = assessment.scenarioBands.expansionRr;
  if (rawExpansionRr === null || rawExpansionRr === undefined) return null;
  const scenarioRr = Number(rawExpansionRr);
  if (!Number.isFinite(scenarioRr)) return null;
  if (scenarioRr <= 0) return null;
  if (scenarioRr < PRICE_DISCOVERY_SCENARIO_RR_FLOOR) {
    return `${PRICE_DISCOVERY_SCENARIO_RR_PREFIX} ${scenarioRr.toFixed(2)} is below the ${PRICE_DISCOVERY_SCENARIO_RR_FLOOR.toFixed(1)} entry floor.`;
  }
  return null;
}

export function isSpotMomentumEntryTimingOnlyRejection(reason: string) {
  return (
    reason.startsWith("R:R ") ||
    reason === "Reward magnitude is negligible." ||
    reason ===
      "ProX requires a current-session reclaim after severe post-peak structure damage." ||
    reason.startsWith(PRICE_DISCOVERY_SCENARIO_RR_PREFIX) ||
    reason ===
      "Price discovery lacks a measurable structural-risk scenario."
  );
}

type AuthorityInput = {
  rejectionReasons: string[];
  fullDayChangePercent: number;
  peakFailureConfirmed: boolean;
};

export function enforceSpotMomentumAuthority({
  rejectionReasons,
  fullDayChangePercent,
  peakFailureConfirmed,
}: AuthorityInput) {
  const reasons = [...rejectionReasons];
  if (!(Number.isFinite(fullDayChangePercent) && fullDayChangePercent > 0)) {
    reasons.push(POSITIVE_FULL_DAY_MOMENTUM_REQUIRED);
  }
  if (peakFailureConfirmed) {
    reasons.push(PROX_PEAK_FAILURE_BLOCK);
  }
  return [...new Set(reasons)];
}

export function preserveDisplayHardFailures(
  rejectionReasons: string[],
  removablePriceDiscontinuity: string | null,
) {
  if (!removablePriceDiscontinuity) return [...rejectionReasons];
  return rejectionReasons.filter(
    (reason) => reason !== removablePriceDiscontinuity,
  );
}
