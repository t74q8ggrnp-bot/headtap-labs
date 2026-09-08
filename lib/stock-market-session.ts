export type StockMarketSession =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "closed";

export type StockMarketClock = {
  session: StockMarketSession;
  easternDate: string;
  active: boolean;
};

export function getStockMarketClock(now = new Date()): StockMarketClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const rawHour = Number(value("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(value("minute"));
  const minutes = hour * 60 + minute;
  const easternDate = `${value("year")}-${value("month")}-${value("day")}`;

  let session: StockMarketSession = "closed";
  if (weekday !== "Sat" && weekday !== "Sun") {
    if (minutes >= 240 && minutes < 570) session = "pre_market";
    else if (minutes >= 570 && minutes < 960) session = "regular";
    else if (minutes >= 960 && minutes < 1200) session = "after_hours";
  }

  return { session, easternDate, active: session !== "closed" };
}

// Uses the same weekday/extended-hours calendar as the existing stock clock.
// Holidays are deliberately not inferred: an older source date must not be
// silently blessed as the latest session without a verified holiday calendar.
export function getLastCompletedStockSessionDate(now = new Date()): string | null {
  const clock = getStockMarketClock(now);
  if (clock.active) return null;
  const date = new Date(`${clock.easternDate}T12:00:00Z`);
  const beforeDawn = getStockMarketClock(new Date(now.getTime() - 8 * 3600_000)).easternDate !== clock.easternDate;
  if (beforeDawn) date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function stockHistoryLabel(asOf: string | null | undefined, now = new Date()): string {
  const sourceMs = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(sourceMs)) return "Awaiting verified data";
  const clock = getStockMarketClock(now);
  const sourceDate = getStockMarketClock(new Date(sourceMs)).easternDate;
  return clock.active && sourceDate === clock.easternDate
    ? "Current session"
    : `Last session · ${sourceDate}`;
}
