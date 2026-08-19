type MomentumRankable = {
  ticker: string;
  strategyScore: number;
  signalStrength: number;
  relativeVolume: number;
};

export function selectOverallMomentumContenders<
  T extends MomentumRankable,
>(
  hero: T | undefined,
  qualified: T[],
  entryWithheld: T[],
  limit: number,
) {
  const seen = new Set<string>();
  const heroTicker = hero?.ticker;

  return [...qualified, ...entryWithheld]
    .filter((candidate) => {
      if (candidate.ticker === heroTicker || seen.has(candidate.ticker)) {
        return false;
      }
      seen.add(candidate.ticker);
      return true;
    })
    .sort(
      (left, right) =>
        right.strategyScore - left.strategyScore ||
        right.signalStrength - left.signalStrength ||
        right.relativeVolume - left.relativeVolume,
    )
    .slice(0, limit);
}
