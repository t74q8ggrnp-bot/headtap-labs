function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function getCanonicalMomentumMagnitude(candidate: {
  change: number;
  activeSessionChangePercent?: number | null;
  sessionReclaim?: boolean;
}) {
  const fullDayCore = clamp(Math.max(0, candidate.change) * 3);
  const activeSessionChange = candidate.activeSessionChangePercent;
  if (activeSessionChange === null || activeSessionChange === undefined) {
    return fullDayCore;
  }
  const activeSessionCore = clamp(Math.max(0, activeSessionChange) * 3);
  return candidate.sessionReclaim
    ? activeSessionCore
    : Math.round(fullDayCore * 0.45 + activeSessionCore * 0.55);
}

export function getSpotMomentumStrategyScore(input: {
  change: number;
  activeSessionChangePercent?: number | null;
  sessionReclaim?: boolean;
  breakoutScore: number;
  qualityScore: number;
  sessionAlignmentAdjustment: number;
  proxMarketAdjustment: number;
}) {
  const magnitudeCore = getCanonicalMomentumMagnitude({
    change: input.change,
    activeSessionChangePercent: input.activeSessionChangePercent,
    sessionReclaim: input.sessionReclaim,
  });
  const baseScore = Math.round(
    magnitudeCore * 0.5 +
      input.breakoutScore * 0.35 +
      input.qualityScore * 0.15,
  );
  return Math.round(
    clamp(
      baseScore +
        input.sessionAlignmentAdjustment +
        input.proxMarketAdjustment,
    ),
  );
}
