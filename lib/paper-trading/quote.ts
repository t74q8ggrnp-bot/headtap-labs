import {
  resolveSnapshotChangePercent,
  resolveSnapshotDisplayPrice,
  resolveSnapshotTimestampMs,
} from "@/lib/polygon-snapshot";
import {
  fetchMassiveLastQuote,
  fetchMassiveLastTrade,
  fetchMassiveStockSnapshot,
} from "@/lib/massive-stocks";
import type { PaperQuote } from "./engine";

export async function getPaperTradingQuote(symbol: string): Promise<PaperQuote> {
  const [row, liveTrade, liveQuote] = await Promise.all([
    fetchMassiveStockSnapshot(symbol),
    fetchMassiveLastTrade(symbol),
    fetchMassiveLastQuote(symbol),
  ]);
  if (!row) throw new Error("No verified market snapshot is available for this symbol.");
  const snapshotPrice = resolveSnapshotDisplayPrice(row);
  const snapshotTimestampMs = resolveSnapshotTimestampMs(row);
  const tradeTimestampMs = liveTrade ? Date.parse(liveTrade.timestamp) : null;
  const useLiveTrade = Boolean(
    liveTrade &&
      tradeTimestampMs !== null &&
      (snapshotTimestampMs === null || tradeTimestampMs >= snapshotTimestampMs),
  );
  const price = useLiveTrade ? liveTrade!.price : snapshotPrice;
  const timestampMs = Math.max(
    snapshotTimestampMs ?? 0,
    tradeTimestampMs ?? 0,
  );
  if (!(price > 0) || timestampMs <= 0) {
    throw new Error("The provider snapshot has no executable price and timestamp.");
  }
  const previousClose = Number(row.prevDay?.c ?? 0);
  return {
    symbol,
    price,
    timestamp: new Date(timestampMs).toISOString(),
    source: liveTrade && liveQuote
      ? "massive_polygon_realtime"
      : "massive_polygon_snapshot",
    dataMode: liveTrade && liveQuote ? "real_time" : "delayed",
    volume: Number(row.day?.v ?? 0),
    previousVolume: Number(row.prevDay?.v ?? 0),
    previousClose,
    sessionOpen: Number(row.day?.o ?? 0),
    sessionHigh: Number(row.day?.h ?? 0),
    sessionLow: Number(row.day?.l ?? 0),
    changePercent: resolveSnapshotChangePercent(row, price),
  };
}
