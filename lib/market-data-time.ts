// Massive Advanced provides real-time stock snapshots and aggregate bars.
// Canonical and bounded ProX authority therefore fail closed when an actively
// trading mover has not produced provider-time evidence within five minutes.
export const ACTIVE_MARKET_DATA_MAX_AGE_MS = 5 * 60 * 1000;
export const CANONICAL_PROX_MARKET_SKEW_MAX_MS = 2 * 60 * 1000;

export function marketTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getMarketDataAgeMs(
  value: unknown,
  now: Date | number = new Date(),
): number | null {
  const timestamp = marketTimestampMs(value);
  if (timestamp === null) return null;
  const nowMs = typeof now === "number" ? now : now.getTime();
  return nowMs - timestamp;
}

export function isActiveMarketTimestampUsable(
  value: unknown,
  now: Date | number = new Date(),
  maxAgeMs = ACTIVE_MARKET_DATA_MAX_AGE_MS,
) {
  const ageMs = getMarketDataAgeMs(value, now);
  return (
    ageMs !== null &&
    ageMs >= -5 * 60 * 1000 &&
    ageMs <= maxAgeMs
  );
}

export function measureMarketTimestampAlignment(
  left: unknown,
  right: unknown,
  maxSkewMs = CANONICAL_PROX_MARKET_SKEW_MAX_MS,
) {
  const leftMs = marketTimestampMs(left);
  const rightMs = marketTimestampMs(right);
  const skewMs =
    leftMs === null || rightMs === null ? null : Math.abs(leftMs - rightMs);
  return {
    aligned: skewMs !== null && skewMs <= maxSkewMs,
    skewMs,
    maxSkewMs,
  };
}
