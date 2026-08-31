import type {
  ProxMarketDiscoveryFlag,
  ProxMarketSession,
} from "@/lib/prox/market-discovery";

export const PROX_OUTCOME_MEMORY_VERSION =
  "prox-outcome-memory-v2-security-routed";
export const PROX_CALIBRATION_VERSION =
  "prox-pattern-calibration-v2-security-routed";
export const PROX_OUTCOME_MODE = "shadow_research" as const;
export const PROX_SHADOW_BOARD_OUTCOMES_VERSION =
  "prox-shadow-board-outcomes-v3-due-first-market-sessions";

export type ProxOutcomeHorizon =
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "session_close"
  | "next_session"
  | "24h";

export type ProxOutcomeLabel =
  | "unlabeled"
  | "early_continuation"
  | "quiet_accumulation_breakout"
  | "reclaim_continuation"
  | "late_chase"
  | "post_peak_failure"
  | "high_volume_breakdown"
  | "corporate_action_distortion"
  | "inconclusive";

export type ProxEpisodeHorizonTarget = {
  horizon: ProxOutcomeHorizon;
  targetAt: string;
};

export type ProxOutcomeLabelInput = {
  anomalyFlags: ProxMarketDiscoveryFlag[];
  maxGainPercent: number;
  maxDrawdownPercent: number;
  returnByHorizon: Partial<Record<ProxOutcomeHorizon, number>>;
};

export type ProxCalibrationEpisode = {
  patternSignature: string;
  marketSession: ProxMarketSession;
  label: ProxOutcomeLabel;
  maxGainPercent: number;
  maxDrawdownPercent: number;
  timeToPeakMinutes: number | null;
};

export type ProxPatternCalibration = {
  calibrationKey: string;
  patternSignature: string;
  marketSession: ProxMarketSession;
  sampleSize: number;
  continuationCount: number;
  failureCount: number;
  inconclusiveCount: number;
  continuationRate: number;
  averageMaxGainPercent: number;
  averageMaxDrawdownPercent: number;
  averageTimeToPeakMinutes: number | null;
  evidenceState: "insufficient" | "emerging" | "calibrated";
};

const CONTINUATION_LABELS = new Set<ProxOutcomeLabel>([
  "early_continuation",
  "quiet_accumulation_breakout",
  "reclaim_continuation",
]);

const FAILURE_LABELS = new Set<ProxOutcomeLabel>([
  "late_chase",
  "post_peak_failure",
  "high_volume_breakdown",
]);

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function addMinutes(value: string, minutes: number) {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function nextWeekdayTimestamp(value: string) {
  const date = new Date(value);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}

function nextWeekdayDate(easternDate: string) {
  const [year, month, day] = easternDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

function easternWallClockToUtc(
  easternDate: string,
  hour: number,
  minute: number,
) {
  const [year, month, day] = easternDate.split("-").map(Number);
  const desiredWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desiredWallClock;

  // Iteratively compare the desired Eastern wall clock with how the current
  // UTC guess formats in New York. This handles EST/EDT without a dependency.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const value = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const displayedHour = value("hour") === 24 ? 0 : value("hour");
    const displayedWallClock = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      displayedHour,
      value("minute"),
    );
    guess += desiredWallClock - displayedWallClock;
  }
  return new Date(guess).toISOString();
}

export function getProxEpisodeHorizonTargets(input: {
  startedAt: string;
  tradingDate: string;
  marketSession: ProxMarketSession;
}): ProxEpisodeHorizonTarget[] {
  const sessionCloseDate =
    input.marketSession === "pre_market" || input.marketSession === "regular"
      ? input.tradingDate
      : nextWeekdayDate(input.tradingDate);
  return [
    { horizon: "5m", targetAt: addMinutes(input.startedAt, 5) },
    { horizon: "15m", targetAt: addMinutes(input.startedAt, 15) },
    { horizon: "30m", targetAt: addMinutes(input.startedAt, 30) },
    { horizon: "1h", targetAt: addMinutes(input.startedAt, 60) },
    { horizon: "4h", targetAt: addMinutes(input.startedAt, 240) },
    {
      horizon: "session_close",
      targetAt: easternWallClockToUtc(sessionCloseDate, 16, 0),
    },
    {
      horizon: "next_session",
      targetAt: easternWallClockToUtc(nextWeekdayDate(input.tradingDate), 9, 35),
    },
    {
      horizon: "24h",
      targetAt: nextWeekdayTimestamp(addMinutes(input.startedAt, 24 * 60)),
    },
  ];
}

export function selectProxPatternSignature(
  flags: ProxMarketDiscoveryFlag[],
) {
  const ordered: ProxMarketDiscoveryFlag[] = [
    "corporate_action_dislocation",
    "quiet_participation",
    "session_reclaim",
    "downside_volume_breakdown",
    "post_peak_deterioration",
    "liquidity_surge",
    "price_expansion",
    "volume_breakout",
    "near_session_high",
  ];
  return ordered.find((flag) => flags.includes(flag)) ?? "unclassified";
}

export function computeProxReturnPercent(entryPrice: number, price: number) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return round(((price - entryPrice) / entryPrice) * 100);
}

export function labelProxOutcome(input: ProxOutcomeLabelInput): {
  label: ProxOutcomeLabel;
  ready: boolean;
  calibratable: boolean;
  reason: string;
} {
  const flags = new Set(input.anomalyFlags);
  const terminalReturn =
    input.returnByHorizon["24h"] ??
    input.returnByHorizon.next_session ??
    input.returnByHorizon.session_close ??
    input.returnByHorizon["4h"] ??
    null;
  const earlyReturn =
    input.returnByHorizon["1h"] ??
    input.returnByHorizon["30m"] ??
    terminalReturn;
  const ready = terminalReturn !== null && Number.isFinite(terminalReturn);

  if (flags.has("corporate_action_dislocation")) {
    return {
      label: "corporate_action_distortion",
      ready: true,
      calibratable: false,
      reason:
        "A corporate-action discontinuity is present, so this episode is quarantined from learning.",
    };
  }
  if (!ready || earlyReturn === null) {
    return {
      label: "unlabeled",
      ready: false,
      calibratable: false,
      reason: "The episode has not reached a reliable labeling horizon.",
    };
  }

  if (
    flags.has("downside_volume_breakdown") &&
    (terminalReturn < 0 || input.maxDrawdownPercent <= -5)
  ) {
    return {
      label: "high_volume_breakdown",
      ready: true,
      calibratable: true,
      reason: "Heavy participation resolved defensively instead of continuing upward.",
    };
  }
  if (
    flags.has("post_peak_deterioration") &&
    (terminalReturn <= 0 || input.maxDrawdownPercent <= -8)
  ) {
    return {
      label: "post_peak_failure",
      ready: true,
      calibratable: true,
      reason: "A deteriorating setup failed to recover its earlier expansion.",
    };
  }
  if (
    flags.has("quiet_participation") &&
    input.maxGainPercent >= 5 &&
    earlyReturn >= 1.5 &&
    input.maxDrawdownPercent > -8
  ) {
    return {
      label: "quiet_accumulation_breakout",
      ready: true,
      calibratable: true,
      reason: "Quiet cumulative participation converted into durable expansion.",
    };
  }
  if (
    flags.has("session_reclaim") &&
    input.maxGainPercent >= 5 &&
    earlyReturn >= 1.5 &&
    input.maxDrawdownPercent > -8
  ) {
    return {
      label: "reclaim_continuation",
      ready: true,
      calibratable: true,
      reason: "The active-session reclaim produced measurable continuation.",
    };
  }
  if (
    input.maxGainPercent >= 5 &&
    earlyReturn >= 2 &&
    input.maxDrawdownPercent > -8
  ) {
    return {
      label: "early_continuation",
      ready: true,
      calibratable: true,
      reason: "Expansion occurred early without first requiring excessive adverse movement.",
    };
  }
  if (
    (input.maxDrawdownPercent <= -8 && terminalReturn < 2) ||
    (input.maxGainPercent >= 8 && terminalReturn <= 0)
  ) {
    return {
      label: "late_chase",
      ready: true,
      calibratable: true,
      reason: "The setup required excessive drawdown or surrendered its expansion.",
    };
  }
  return {
    label: "inconclusive",
    ready: true,
    calibratable: true,
    reason: "The observed path did not cleanly satisfy continuation or failure criteria.",
  };
}

export function buildProxPatternCalibrations(
  episodes: ProxCalibrationEpisode[],
): ProxPatternCalibration[] {
  const groups = new Map<string, ProxCalibrationEpisode[]>();
  for (const episode of episodes) {
    if (
      episode.label === "unlabeled" ||
      episode.label === "corporate_action_distortion"
    ) {
      continue;
    }
    const key = `${PROX_CALIBRATION_VERSION}:${episode.patternSignature}:${episode.marketSession}`;
    const group = groups.get(key) ?? [];
    group.push(episode);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([calibrationKey, group]) => {
    const sampleSize = group.length;
    const continuationCount = group.filter((episode) =>
      CONTINUATION_LABELS.has(episode.label),
    ).length;
    const failureCount = group.filter((episode) =>
      FAILURE_LABELS.has(episode.label),
    ).length;
    const peakTimes = group
      .map((episode) => episode.timeToPeakMinutes)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    return {
      calibrationKey,
      patternSignature: group[0].patternSignature,
      marketSession: group[0].marketSession,
      sampleSize,
      continuationCount,
      failureCount,
      inconclusiveCount: sampleSize - continuationCount - failureCount,
      continuationRate: round(continuationCount / sampleSize, 4),
      averageMaxGainPercent: round(
        group.reduce(
          (sum, episode) => sum + finiteNumber(episode.maxGainPercent),
          0,
        ) / sampleSize,
      ),
      averageMaxDrawdownPercent: round(
        group.reduce(
          (sum, episode) => sum + finiteNumber(episode.maxDrawdownPercent),
          0,
        ) / sampleSize,
      ),
      averageTimeToPeakMinutes:
        peakTimes.length > 0
          ? round(
              peakTimes.reduce((sum, value) => sum + value, 0) /
                peakTimes.length,
              1,
            )
          : null,
      evidenceState:
        sampleSize >= 100
          ? "calibrated"
          : sampleSize >= 30
            ? "emerging"
            : "insufficient",
    };
  });
}
