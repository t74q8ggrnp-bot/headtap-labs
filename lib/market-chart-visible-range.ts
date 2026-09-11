export type MarketChartVisibleRange = "1h" | "2h" | "session";

export type MarketChartLogicalRange = {
  from: number;
  to: number;
};

const rangeMinutes: Record<Exclude<MarketChartVisibleRange, "session">, number> = {
  "1h": 60,
  "2h": 120,
};

export function marketChartVisibleLogicalRange(input: {
  visibleRange?: MarketChartVisibleRange;
  legacyVisibleMinutes: number;
  intervalSeconds: number;
  pointCount: number;
  rightOffset?: number;
}): MarketChartLogicalRange {
  const rightOffset = Math.max(0, input.rightOffset ?? 2);
  const pointCount = Math.max(0, Math.floor(input.pointCount));
  const to = pointCount + rightOffset;
  if (input.visibleRange === "session") return { from: 0, to };

  const minutes = input.visibleRange
    ? rangeMinutes[input.visibleRange]
    : input.legacyVisibleMinutes;
  const intervalMinutes = Math.max(input.intervalSeconds / 60, 1 / 60);
  const visiblePoints = Math.max(1, Math.floor(minutes / intervalMinutes));
  return {
    from: Math.max(0, pointCount - visiblePoints),
    to,
  };
}

export function marketChartIsFollowingLatest(
  range: MarketChartLogicalRange | null | undefined,
  pointCount: number,
) {
  if (!range || pointCount <= 0) return true;
  return range.to >= Math.max(0, pointCount - 1);
}
