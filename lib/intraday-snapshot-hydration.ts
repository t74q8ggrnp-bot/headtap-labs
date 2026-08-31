import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import {
  easternMinuteOfDay,
  summarizeIntradaySessionBars,
  type StockSessionName,
} from "@/lib/intraday-session-bars";

type PolygonAggregate = {
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  t?: unknown;
};

export type HydratedSessionSnapshot = {
  price: number;
  currentVolume: number;
  sessionOpenPrice: number | null;
  sessionHighPrice: number | null;
  sessionLowPrice: number | null;
  changeFromOpenPercent: number | null;
  latestBarAt: string;
};

const MAX_HYDRATION_CANDIDATES = 120;
const HYDRATION_CONCURRENCY = 15;
const MIN_DISCOVERY_CHANGE_PERCENT = 1;

function easternDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export async function fetchHydratedSessionSnapshot(
  ticker: string,
  apiKey: string,
  session: StockSessionName,
): Promise<HydratedSessionSnapshot | null> {
  const today = easternDateString();
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
    `/range/1/minute/${today}/${today}?adjusted=true&sort=asc&limit=1000&apiKey=${apiKey}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const payload: unknown = await response.json();
  const results =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: PolygonAggregate[] }).results
      : [];
  const bars = results
    .map((row) => ({
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v),
      timestamp: Number(row.t),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.close) &&
        bar.close > 0 &&
        Number.isFinite(bar.timestamp) &&
        bar.timestamp > 0,
    )
    .filter((bar) => {
      const minute = easternMinuteOfDay(bar.timestamp);
      return minute >= 240 && minute < 1200;
    });
  if (bars.length === 0) return null;

  return summarizeIntradaySessionBars(bars, session);
}

/**
 * Polygon's bulk snapshot can briefly carry a current price without the new
 * session's day/open/volume fields. That used to make genuine opening movers
 * invisible before ProX could inspect them. Hydrate the strongest price-led
 * candidates from the minute aggregate tape before applying volume gates.
 */
export async function hydrateSnapshotLeaders(
  rows: PolygonSnapshotRow[],
  apiKey: string,
  session: StockSessionName,
  options: { maxCandidates?: number; includeCompleteRows?: boolean } = {},
): Promise<Map<string, HydratedSessionSnapshot>> {
  if (session === "closed") return new Map();

  const candidates = rows
    .map((row) => {
      const ticker = String(row.ticker ?? "").trim().toUpperCase();
      const price = resolveSnapshotPrice(row);
      const change = resolveSnapshotChangePercent(row, price);
      const currentVolume = Math.max(
        Number(row.day?.v || 0),
        Number(row.min?.av || 0),
      );
      const hasSessionOpen = Number(row.day?.o || 0) > 0;
      const incomplete = currentVolume <= 0 || !hasSessionOpen;
      return { ticker, change, price, incomplete };
    })
    .filter(
      (candidate) =>
        candidate.ticker &&
        candidate.price > 0 &&
        candidate.change >= MIN_DISCOVERY_CHANGE_PERCENT &&
        (options.includeCompleteRows === true || candidate.incomplete),
    )
    .sort((left, right) => right.change - left.change)
    .slice(0, options.maxCandidates ?? MAX_HYDRATION_CANDIDATES);

  const hydrated = new Map<string, HydratedSessionSnapshot>();
  for (let index = 0; index < candidates.length; index += HYDRATION_CONCURRENCY) {
    const batch = candidates.slice(index, index + HYDRATION_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async ({ ticker }) => ({
        ticker,
        snapshot: await fetchHydratedSessionSnapshot(ticker, apiKey, session),
      })),
    );
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.snapshot) {
        hydrated.set(result.value.ticker, result.value.snapshot);
      }
    }
  }
  return hydrated;
}
