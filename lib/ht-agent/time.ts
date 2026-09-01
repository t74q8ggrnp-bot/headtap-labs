function easternClockParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return {
    year: read("year"), month: read("month"), day: read("day"),
    hour: read("hour"), minute: read("minute"), second: read("second"),
  };
}

function easternLocalTimestamp(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
) {
  const targetLocalClock = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetLocalClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = easternClockParts(new Date(candidate));
    const renderedAsUtc = Date.UTC(
      rendered.year, rendered.month - 1, rendered.day,
      rendered.hour, rendered.minute, rendered.second,
    );
    candidate += targetLocalClock - renderedAsUtc;
  }
  return new Date(candidate);
}

export function getEasternDayStart(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const eastern = easternClockParts(date);
  return easternLocalTimestamp(eastern.year, eastern.month, eastern.day).toISOString();
}

export function getHtAgentSessionCloseTarget(capturedAt: string | Date) {
  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const eastern = easternClockParts(captured);
  const dayCursor = new Date(Date.UTC(eastern.year, eastern.month - 1, eastern.day));
  if (eastern.hour >= 16) dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  while ([0, 6].includes(dayCursor.getUTCDay())) {
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }
  return easternLocalTimestamp(
    dayCursor.getUTCFullYear(),
    dayCursor.getUTCMonth() + 1,
    dayCursor.getUTCDate(),
    16,
  ).toISOString();
}
