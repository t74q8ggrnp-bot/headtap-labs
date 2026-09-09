// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getStockMarketClock } from "./stock-market-session.ts";
import type { MarketChartSessionScope } from "./market-chart-feed.ts";

export const MARKET_CHART_DELTA_INTERVAL_MS = 5_000;
export const MARKET_CHART_INACTIVE_RECHECK_MS = 60_000;
export const MARKET_CHART_FAILURE_BACKOFF_CAP_MS = 60_000;

export type ServerAnchoredClock = {
  accept: (serverTimestamp: string | number | Date | null | undefined) => boolean;
  now: () => number;
  readonly anchored: boolean;
};

/**
 * Convert one trusted server receipt into a monotonic client clock. The device
 * wall clock is used only until the first receipt arrives; afterward a phone
 * or desktop clock skew cannot change session gates or freshness labels.
 */
export function createServerAnchoredClock(options: {
  deviceNow?: () => number;
  monotonicNow?: () => number;
} = {}): ServerAnchoredClock {
  const deviceNow = options.deviceNow ?? (() => Date.now());
  const monotonicNow = options.monotonicNow ?? (() =>
    typeof performance !== "undefined" && Number.isFinite(performance.now())
      ? performance.now()
      : Date.now()
  );
  let serverAnchorMs: number | null = null;
  let monotonicAnchorMs = 0;

  const anchoredNow = () => {
    if (serverAnchorMs === null) return deviceNow();
    return serverAnchorMs + Math.max(0, monotonicNow() - monotonicAnchorMs);
  };

  return {
    accept(serverTimestamp) {
      const parsed = serverTimestamp instanceof Date
        ? serverTimestamp.getTime()
        : typeof serverTimestamp === "number"
          ? serverTimestamp
          : typeof serverTimestamp === "string"
            ? Date.parse(serverTimestamp)
            : Number.NaN;
      if (!Number.isFinite(parsed)) return false;
      const current = serverAnchorMs === null ? parsed : anchoredNow();
      // A delayed/out-of-order HTTP response may not turn the client clock
      // backward. Provider timestamps remain immutable inside the frame.
      serverAnchorMs = Math.max(parsed, current);
      monotonicAnchorMs = monotonicNow();
      return true;
    },
    now: anchoredNow,
    get anchored() {
      return serverAnchorMs !== null;
    },
  };
}

export type MarketChartPollingState = {
  active: boolean;
  reason:
    | "active_session"
    | "outside_session_scope"
    | "weekend"
    | "market_holiday"
    | "early_close";
  retryAfterMs: number;
};

function dateAtUtc(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function observedDate(year: number, monthIndex: number, day: number) {
  const date = dateAtUtc(year, monthIndex, day);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  else if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
}

function newYearsHolidayDate(year: number) {
  const date = dateAtUtc(year, 0, 1);
  // NYSE's year-end accounting exception means a Saturday January 1 does not
  // close the preceding Friday. A Sunday January 1 is observed on Monday.
  // See the published 2026-2028 NYSE calendar.
  if (date.getUTCDay() === 6) return null;
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
}

function nthWeekday(
  year: number,
  monthIndex: number,
  weekday: number,
  ordinal: number,
) {
  const date = dateAtUtc(year, monthIndex, 1);
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (ordinal - 1) * 7);
  return isoDate(date);
}

function lastWeekday(year: number, monthIndex: number, weekday: number) {
  const date = dateAtUtc(year, monthIndex + 1, 0);
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return isoDate(date);
}

// Anonymous Gregorian algorithm. NYSE observes Good Friday even though it is
// not a U.S. federal holiday.
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateAtUtc(year, month - 1, day);
}

export function knownUsStockMarketHoliday(date: string) {
  const year = Number(date.slice(0, 4));
  if (!Number.isInteger(year)) return false;
  const holidays = new Set<string>();
  // Include adjacent years because an observed New Year's Day can fall on
  // December 31 of the preceding calendar year.
  for (const candidateYear of [year - 1, year, year + 1]) {
    const newYear = newYearsHolidayDate(candidateYear);
    if (newYear) holidays.add(newYear);
    holidays.add(nthWeekday(candidateYear, 0, 1, 3)); // MLK Day
    holidays.add(nthWeekday(candidateYear, 1, 1, 3)); // Presidents Day
    const goodFriday = easterSunday(candidateYear);
    goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
    holidays.add(isoDate(goodFriday));
    holidays.add(lastWeekday(candidateYear, 4, 1)); // Memorial Day
    if (candidateYear >= 2022) {
      holidays.add(observedDate(candidateYear, 5, 19)); // Juneteenth
    }
    holidays.add(observedDate(candidateYear, 6, 4));
    holidays.add(nthWeekday(candidateYear, 8, 1, 1)); // Labor Day
    holidays.add(nthWeekday(candidateYear, 10, 4, 4)); // Thanksgiving
    holidays.add(observedDate(candidateYear, 11, 25));
  }
  return holidays.has(date);
}

// Exact early closes in the currently published NYSE 2025-2028 calendar.
// Keep this list explicit: guessing future exceptional sessions would be less
// honest than treating an unpublished date as an ordinary session.
const KNOWN_NYSE_EARLY_CLOSE_DATES = new Set([
  "2025-07-03",
  "2025-11-28",
  "2025-12-24",
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
  "2028-07-03",
  "2028-11-24",
]);

export function knownUsStockMarketEarlyClose(date: string) {
  return KNOWN_NYSE_EARLY_CLOSE_DATES.has(date);
}

function easternMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "0";
  const rawHour = Number(part("hour"));
  return (rawHour === 24 ? 0 : rawHour) * 60 + Number(part("minute"));
}

/**
 * Presentation-feed polling calendar only. It intentionally does not change
 * the broader Canonical/ProX market-session authority.
 */
export function marketChartPollingState(
  now = new Date(),
  sessionScope: MarketChartSessionScope = "extended",
): MarketChartPollingState {
  const clock = getStockMarketClock(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") {
    return {
      active: false,
      reason: "weekend",
      retryAfterMs: MARKET_CHART_INACTIVE_RECHECK_MS,
    };
  }
  if (knownUsStockMarketHoliday(clock.easternDate)) {
    return {
      active: false,
      reason: "market_holiday",
      retryAfterMs: MARKET_CHART_INACTIVE_RECHECK_MS,
    };
  }
  if (knownUsStockMarketEarlyClose(clock.easternDate)) {
    const minutes = easternMinutes(now);
    const active = sessionScope === "regular"
      ? minutes >= 570 && minutes < 780
      // The exchange closes its regular book at 13:00 ET on a half-day, but
      // eligible extended-hours trading and provider updates continue through
      // the ordinary 20:00 ET boundary.
      : minutes >= 240 && minutes < 1_200;
    if (!active) {
      return {
        active: false,
        reason: "early_close",
        retryAfterMs: MARKET_CHART_INACTIVE_RECHECK_MS,
      };
    }
    return {
      active: true,
      reason: "active_session",
      retryAfterMs: MARKET_CHART_DELTA_INTERVAL_MS,
    };
  }
  const active = sessionScope === "regular"
    ? clock.session === "regular"
    : clock.active;
  return active
    ? {
        active: true,
        reason: "active_session",
        retryAfterMs: MARKET_CHART_DELTA_INTERVAL_MS,
      }
    : {
        active: false,
        reason: "outside_session_scope",
        retryAfterMs: MARKET_CHART_INACTIVE_RECHECK_MS,
      };
}

/** Presentation label that uses the same holiday/early-close authority as
 * polling. It does not alter Canonical's market-session ownership. */
export function marketChartHistoryLabel(
  asOf: string | null | undefined,
  now = new Date(),
  sessionScope: MarketChartSessionScope = "extended",
) {
  const sourceMs = asOf ? Date.parse(asOf) : Number.NaN;
  if (!Number.isFinite(sourceMs)) return "Awaiting verified data";
  const sourceDate = getStockMarketClock(new Date(sourceMs)).easternDate;
  const currentDate = getStockMarketClock(now).easternDate;
  return marketChartPollingState(now, sessionScope).active &&
      sourceDate === currentDate
    ? "Current session"
    : `Last session · ${sourceDate}`;
}

export function marketChartSessionRolloverRequired(input: {
  displayedSessionDate: string;
  now?: Date;
  sessionScope?: MarketChartSessionScope;
}) {
  const now = input.now ?? new Date();
  const scope = input.sessionScope ?? "extended";
  return marketChartPollingState(now, scope).active &&
    input.displayedSessionDate !== getStockMarketClock(now).easternDate;
}

/** Bound full-history reloads while an active session has not printed yet. */
export function marketChartRolloverBootstrapDelay(
  lastAttemptAt: number,
  nowMs: number,
  cooldownMs = MARKET_CHART_INACTIVE_RECHECK_MS,
) {
  if (!Number.isFinite(lastAttemptAt) || lastAttemptAt <= 0) return 0;
  const safeNow = Number.isFinite(nowMs) ? nowMs : lastAttemptAt;
  return Math.max(0, cooldownMs - Math.max(0, safeNow - lastAttemptAt));
}

export function alignedMarketChartPollDelay(
  nowMs: number,
  intervalMs = MARKET_CHART_DELTA_INTERVAL_MS,
) {
  const safeInterval = Math.max(1_000, intervalMs);
  const remainder = nowMs % safeInterval;
  return Math.max(250, safeInterval - remainder);
}

export function marketChartFailureBackoffMs(input: {
  attempt: number;
  baseMs?: number;
  capMs?: number;
  retryAfterMs?: number | null;
  random?: () => number;
}) {
  const attempt = Math.max(1, Math.floor(input.attempt));
  const baseMs = Math.max(1_000, input.baseMs ?? MARKET_CHART_DELTA_INTERVAL_MS);
  const capMs = Math.max(baseMs, input.capMs ?? MARKET_CHART_FAILURE_BACKOFF_CAP_MS);
  const localDelay = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  const random = Math.min(1, Math.max(0, (input.random ?? Math.random)()));
  const jittered = Math.min(
    capMs,
    Math.round(localDelay * (0.8 + random * 0.4)),
  );
  return Math.max(jittered, Math.max(0, input.retryAfterMs ?? 0));
}

/**
 * Bootstrap failures still need a bounded recovery path while the market is
 * closed so a workspace can eventually render retained last-session history.
 * Closed sessions never retry faster than the one-minute inactive cadence;
 * active sessions retain exponential backoff and provider Retry-After.
 */
export function marketChartBootstrapRetryDelay(input: {
  now?: Date;
  sessionScope?: MarketChartSessionScope;
  backoffMs: number;
}) {
  const polling = marketChartPollingState(
    input.now ?? new Date(),
    input.sessionScope ?? "extended",
  );
  return Math.max(
    Math.max(0, input.backoffMs),
    polling.active ? 0 : polling.retryAfterMs,
  );
}

export function createMarketChartPollAttemptGate(
  now: () => number = () => Date.now(),
) {
  let running = false;
  let retryNotBefore = 0;
  let startedAt = 0;
  return {
    get running() {
      return running;
    },
    start() {
      if (running || now() < retryNotBefore) return false;
      running = true;
      startedAt = now();
      return true;
    },
    succeed(minimumIntervalMs = 0) {
      running = false;
      retryNotBefore = minimumIntervalMs > 0
        ? startedAt + minimumIntervalMs
        : 0;
    },
    fail(delayMs: number) {
      running = false;
      retryNotBefore = Math.max(
        retryNotBefore,
        now() + Math.max(0, delayMs),
      );
    },
    delay(requestedDelayMs: number) {
      return Math.max(
        Math.max(0, requestedDelayMs),
        Math.max(0, retryNotBefore - now()),
      );
    },
    stop() {
      running = false;
      retryNotBefore = 0;
      startedAt = 0;
    },
  };
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs = Date.now(),
) {
  const raw = value?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

export function providerResponseRequiresBackoff(
  status: number,
  retryAfter: string | null | undefined,
) {
  return status === 429 || status === 503 ||
    (status >= 400 && Boolean(retryAfter?.trim()));
}

export class MarketChartHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message);
    this.name = "MarketChartHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function marketChartProviderCallBudget(input: {
  active: boolean;
  intervalMs?: number;
  includeBootstrap?: boolean;
}) {
  const intervalMs = Math.max(1_000, input.intervalMs ?? MARKET_CHART_DELTA_INTERVAL_MS);
  const deltaPollsPerMinute = input.active ? Math.floor(60_000 / intervalMs) : 0;
  const deltaCallsPerMinute = deltaPollsPerMinute * 2;
  const bootstrapCalls = input.includeBootstrap ? 4 : 0;
  return {
    bootstrapCalls,
    deltaPollsPerMinute,
    deltaCallsPerMinute,
    totalCalls: bootstrapCalls + deltaCallsPerMinute,
  };
}
