import type { PolygonSnapshotRow } from "./polygon-snapshot";
import type { MassiveLastTrade } from "./massive-stocks";

export type StockDisplayPrice = {
  price: number;
  asOf: string;
  source: "massive_polygon_last_trade" | "massive_polygon_snapshot";
  priceKind: "trade" | "minute_aggregate";
  size: number | null;
};

function providerMilliseconds(value: unknown): number | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp >= 1e17 ? timestamp / 1e6 : timestamp >= 1e14 ? timestamp / 1e3 : timestamp;
}

/** Presentation only. Never feed this resolver into Canonical/ProX scoring.
 * A displayed price and its clock must come from the SAME provider observation.
 * A large daily move is not a reason to replace a real print with an old close.
 * Undated day/previous closes cannot borrow a fresh trade's timestamp. */
export function resolveStockDisplayPrice(
  snapshot: PolygonSnapshotRow | null,
  directTrade: MassiveLastTrade | null = null,
  now = Date.now(),
): StockDisplayPrice | null {
  const candidates = [
    { price: directTrade?.price, timestamp: directTrade ? Date.parse(directTrade.timestamp) : null,
      source: "massive_polygon_last_trade" as const, priceKind: "trade" as const, size: directTrade?.size ?? null },
    { price: snapshot?.lastTrade?.p, timestamp: providerMilliseconds(snapshot?.lastTrade?.t),
      source: "massive_polygon_snapshot" as const, priceKind: "trade" as const, size: null },
    { price: snapshot?.min?.c, timestamp: providerMilliseconds(snapshot?.min?.t),
      source: "massive_polygon_snapshot" as const, priceKind: "minute_aggregate" as const, size: null },
  ].flatMap(candidate => {
    const price = Number(candidate.price), at = candidate.timestamp;
    if (!(price > 0) || !Number.isFinite(price) || at === null || !Number.isFinite(at) || at <= 0 || at > now + 2_000) return [];
    return [{ price, asOf: new Date(at).toISOString(), source: candidate.source,
      priceKind: candidate.priceKind, size: candidate.size, at }];
  }).sort((a, b) => b.at - a.at);
  const latest = candidates[0];
  return latest ? { price: latest.price, asOf: latest.asOf, source: latest.source,
    priceKind: latest.priceKind, size: latest.size } : null;
}
