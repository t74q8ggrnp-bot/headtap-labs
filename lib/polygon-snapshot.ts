const positiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

type PolygonSnapshotRow = {
  day?: { c?: unknown };
  min?: { c?: unknown; t?: unknown };
  prevDay?: { c?: unknown };
  lastTrade?: { p?: unknown; t?: unknown };
  todaysChangePerc?: unknown;
};

const timestampMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed >= 1e17) return parsed / 1e6;
  if (parsed >= 1e14) return parsed / 1e3;
  return parsed;
};

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
 * Display-only price resolution can be more current than the canonical scan
 * price without changing ranking or trading decisions. Trust Polygon's latest
 * minute/trade only when it carries a recent timestamp and remains reasonably
 * consistent with the regular-session reference; otherwise retain the stable
 * aggregate close used by the canonical engine.
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
    return ((price - previousClose) / previousClose) * 100;
  }
  const reported = Number(row?.todaysChangePerc);
  return Number.isFinite(reported) ? reported : 0;
}
