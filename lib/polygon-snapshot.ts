const positiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Polygon snapshot payloads can contain an old lastTrade while the aggregate
 * day/minute bars are current. Prefer aggregate closes and only trust
 * lastTrade when it is reasonably consistent with the previous close.
 */
export function resolveSnapshotPrice(row: any): number {
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

export function resolveSnapshotChangePercent(row: any, price: number): number {
  const previousClose = positiveNumber(row?.prevDay?.c);
  if (previousClose !== null && price > 0) {
    return ((price - previousClose) / previousClose) * 100;
  }
  const reported = Number(row?.todaysChangePerc);
  return Number.isFinite(reported) ? reported : 0;
}
