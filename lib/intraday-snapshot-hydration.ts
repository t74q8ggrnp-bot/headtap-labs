import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";

type PolygonAggregate = {
  o?: unknown;
  h?: unknown;
  c?: unknown;
  v?: unknown;
  t?: unknown;
};

export type HydratedSessionSnapshot = {
  price: number;
  currentVolume: number;
  sessionOpenPrice: number | null;
  sessionHighPrice: number | null;
  changeFromOpenPercent: number | null;
  latestBarAt: string;
};

type SessionName = "pre_market" | "regular" | "after_hours" | "closed";

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

function easternMinuteOfDay(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function activeSessionStart(session: SessionName): number {
  if (session === "regular") return 570;
  if (session === "after_hours") return 960;
  return 240;
}

async function fetchHydratedSessionSnapshot(
  ticker: string,
  apiKey: string,
  session: SessionName,
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

  const startMinute = activeSessionStart(session);
  const activeBars = bars.filter(
    (bar) => easternMinuteOfDay(bar.timestamp) >= startMinute,
  );
  const sessionBars = activeBars.length > 0 ? activeBars : bars;
  const latest = bars[bars.length - 1];
  const sessionOpen = sessionBars[0]?.open;
  const sessionHigh = sessionBars.reduce(
    (highest, bar) =>
      Number.isFinite(bar.high) ? Math.max(highest, bar.high) : highest,
    latest.close,
  );
  const currentVolume = bars.reduce(
    (total, bar) =>
      total + (Number.isFinite(bar.volume) ? Math.max(0, bar.volume) : 0),
    0,
  );
  const validOpen = Number.isFinite(sessionOpen) && sessionOpen > 0
    ? sessionOpen
    : null;

  return {
    price: latest.close,
    currentVolume,
    sessionOpenPrice: validOpen,
    sessionHighPrice: Number.isFinite(sessionHigh) ? sessionHigh : latest.close,
    changeFromOpenPercent:
      validOpen === null
        ? null
        : ((latest.close - validOpen) / validOpen) * 100,
    latestBarAt: new Date(latest.timestamp).toISOString(),
  };
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
  session: SessionName,
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
