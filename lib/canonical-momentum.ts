function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function getCanonicalMomentumMagnitude(candidate: { change: number }) {
  // Spot Momentum is a leaderboard of the verified move from the previous
  // close. The current-session move is valuable context, but blending it into
  // this magnitude core diluted genuine +50–100% leaders whenever they traded
  // slightly below the 9:30 open and double-counted smaller moves that were
  // positive on both references. Session direction and ProX remain explicit
  // context in the opportunity engine; they must not replace this anchor.
  return clamp(Math.max(0, candidate.change) * 3);
}

export function getSpotMomentumStrategyScore(input: {
  change: number;
  breakoutScore: number;
  qualityScore: number;
  sessionAlignmentAdjustment: number;
  proxMarketAdjustment: number;
}) {
  const magnitudeCore = getCanonicalMomentumMagnitude({
    change: input.change,
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
