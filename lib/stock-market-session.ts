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
