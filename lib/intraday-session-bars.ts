export type StockSessionName =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "closed";

export type IntradaySessionBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

export function easternMinuteOfDay(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hour * 60 + minute;
}

function activeSessionStart(session: StockSessionName): number {
  if (session === "regular") return 570;
  if (session === "after_hours") return 960;
  return 240;
}

export function summarizeIntradaySessionBars(
  bars: IntradaySessionBar[],
  session: StockSessionName,
) {
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
  const sessionLow = sessionBars.reduce(
    (lowest, bar) =>
      Number.isFinite(bar.low) ? Math.min(lowest, bar.low) : lowest,
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
    sessionLowPrice: Number.isFinite(sessionLow) ? sessionLow : latest.close,
    changeFromOpenPercent:
      validOpen === null
        ? null
        : ((latest.close - validOpen) / validOpen) * 100,
    latestBarAt: new Date(latest.timestamp).toISOString(),
  };
}
