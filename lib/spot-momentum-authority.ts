export const POSITIVE_FULL_DAY_MOMENTUM_REQUIRED =
  "Spot Momentum requires positive movement versus the previous close.";

export const PROX_PEAK_FAILURE_BLOCK =
  "ProX confirms post-peak deterioration.";

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
