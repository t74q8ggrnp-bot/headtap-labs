const positiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export type PolygonSnapshotRow = {
  ticker?: unknown;
  day?: { o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };
  min?: { av?: unknown; c?: unknown; t?: unknown };
  prevDay?: { c?: unknown; v?: unknown };
  lastTrade?: { p?: unknown; t?: unknown };
  todaysChangePerc?: unknown;
};

export function resolveSnapshotSessionOpen(row: PolygonSnapshotRow): number {
  return positiveNumber(row?.day?.o) ?? 0;
}

export function resolveSnapshotSessionHigh(
  row: PolygonSnapshotRow,
  price: number,
): number | null {
  const reportedHigh = positiveNumber(row?.day?.h);
  if (reportedHigh === null && price <= 0) return null;
  return Math.max(reportedHigh ?? 0, price);
}

export function resolveSnapshotPullbackFromSessionHighPercent(
  row: PolygonSnapshotRow,
  price: number,
): number | null {
  const sessionHigh = resolveSnapshotSessionHigh(row, price);
  if (sessionHigh === null || sessionHigh <= 0 || price <= 0) return null;
  return Math.max(0, ((sessionHigh - price) / sessionHigh) * 100);
}

export function resolveSnapshotChangeFromOpenPercent(
  row: PolygonSnapshotRow,
  price: number,
): number | null {
  const sessionOpen = resolveSnapshotSessionOpen(row);
  if (sessionOpen <= 0 || price <= 0) return null;
  return ((price - sessionOpen) / sessionOpen) * 100;
}

const timestampMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed >= 1e17) return parsed / 1e6;
  if (parsed >= 1e14) return parsed / 1e3;
  return parsed;
};

export function resolveSnapshotTimestampMs(
  row: PolygonSnapshotRow,
): number | null {
  const timestamps = [
    timestampMs(row?.min?.t),
    timestampMs(row?.lastTrade?.t),
  ].filter((value): value is number => value !== null);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

/**
 * Polygon snapshot payloads can contain an old lastTrade while the aggregate
 * day/minute bars are current. Prefer aggregate closes and only trust
 * lastTrade when it is reasonably consistent with the previous close.
 */
export function resolveSnapshotPrice(row: PolygonSnapshotRow): number {
  const dayClose = positiveNumber(row?.day?.c);
  if (dayClose !== null) return dayClose;

  const minuteClose = positiveNumber(row?.min?.c);
  if (minuteClose !== null) return minuteClose;

  const previousClose = positiveNumber(row?.prevDay?.c);
  const lastTrade = positiveNumber(row?.lastTrade?.p);
  if (lastTrade !== null) {
    if (previousClose === null) return lastTrade;
    const deviation = Math.abs(lastTrade - previousClose) / previousClose;
    if (deviation <= 0.35) return lastTrade;
  }

  return previousClose ?? 0;
}

/**
 * Resolve the current price used by both canonical evaluation and display.
 * Trust Polygon's latest minute/trade only when it carries a recent timestamp
 * and remains reasonably consistent with the regular-session reference;
 * otherwise retain the stable aggregate close.
 */
export function resolveSnapshotDisplayPrice(
  row: PolygonSnapshotRow,
  now = new Date(),
): number {
  const stablePrice = resolveSnapshotPrice(row);
  const referencePrice =
    positiveNumber(row?.prevDay?.c) ??
    positiveNumber(row?.day?.c) ??
    stablePrice;
  const candidates = [
    {
      price: positiveNumber(row?.min?.c),
      timestamp: timestampMs(row?.min?.t),
    },
    {
      price: positiveNumber(row?.lastTrade?.p),
      timestamp: timestampMs(row?.lastTrade?.t),
    },
  ]
    .filter(
      (
        candidate,
      ): candidate is { price: number; timestamp: number } =>
        candidate.price !== null && candidate.timestamp !== null,
    )
    .filter((candidate) => {
      const ageMs = now.getTime() - candidate.timestamp;
      if (ageMs < -5 * 60 * 1000 || ageMs > 18 * 60 * 60 * 1000) {
        return false;
      }
      if (!referencePrice) return true;
      return Math.abs(candidate.price - referencePrice) / referencePrice <= 0.35;
    })
    .sort((left, right) => right.timestamp - left.timestamp);

  return candidates[0]?.price ?? stablePrice;
}

export function resolveSnapshotChangePercent(
  row: PolygonSnapshotRow,
  price: number,
): number {
  const previousClose = positiveNumber(row?.prevDay?.c);
  if (previousClose !== null && price > 0) {
    const derivedChange = ((price - previousClose) / previousClose) * 100;
    const sessionOpen = resolveSnapshotSessionOpen(row);
    if (Math.abs(derivedChange) >= 500 && sessionOpen > 0) {
      const openGap = ((sessionOpen - previousClose) / previousClose) * 100;
      if (Math.abs(openGap) >= 500) {
        const reported = Number(row?.todaysChangePerc);
        if (Number.isFinite(reported) && Math.abs(reported) < 500) {
          return reported;
        }
        // A 500%+ discontinuity already present at today's open is normally a
        // split/corporate-action reference mismatch, not organic momentum.
        // Until adjusted reference data confirms otherwise, measure only the
        // move observed in today's session instead of publishing thousands of
        // percent of fabricated performance.
        return ((price - sessionOpen) / sessionOpen) * 100;
      }
    }
    return derivedChange;
  }
  const reported = Number(row?.todaysChangePerc);
  return Number.isFinite(reported) ? reported : 0;
}
