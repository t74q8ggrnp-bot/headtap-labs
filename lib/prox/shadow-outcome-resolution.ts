import type { ProxOutcomeHorizon } from "@/lib/prox/outcome-memory";

export const PROX_OUTCOME_BAR_TOLERANCE_MS = 10 * 60_000;
export const PROX_OUTCOME_UNAVAILABLE_AFTER_MS = 7 * 24 * 60 * 60_000;

export type ProxOutcomeBar = {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ProxResolvedHorizon = {
  horizon: ProxOutcomeHorizon;
  targetAt: string;
  state: "measured" | "unavailable" | "pending";
  measuredAt: string | null;
  measuredPrice: number | null;
  unavailableReason: string | null;
};

function validBar(bar: ProxOutcomeBar) {
  return (
    Number.isFinite(bar.timeMs) &&
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    bar.timeMs > 0 &&
    bar.open > 0 &&
    bar.high > 0 &&
    bar.low > 0 &&
    bar.close > 0 &&
    bar.high >= bar.low
  );
}

export function normalizeProxOutcomeBars(bars: ProxOutcomeBar[]) {
  const byTimestamp = new Map<number, ProxOutcomeBar>();
  for (const bar of bars) {
    if (validBar(bar)) byTimestamp.set(bar.timeMs, bar);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timeMs - right.timeMs);
}

export function findProxOutcomeBarAtTarget(
  bars: ProxOutcomeBar[],
  targetAt: string,
  toleranceMs = PROX_OUTCOME_BAR_TOLERANCE_MS,
) {
  const targetMs = new Date(targetAt).getTime();
  if (!Number.isFinite(targetMs)) return null;
  const normalized = normalizeProxOutcomeBars(bars);
  let closest: ProxOutcomeBar | null = null;
  let closestDistance = Infinity;
  for (const bar of normalized) {
    const distance = Math.abs(bar.timeMs - targetMs);
    if (
      distance < closestDistance ||
      (distance === closestDistance && closest && bar.timeMs <= targetMs)
    ) {
      closest = bar;
      closestDistance = distance;
    }
  }
  return closest && closestDistance <= toleranceMs ? closest : null;
}

export function resolveProxOutcomeHorizon({
  horizon,
  targetAt,
  bars,
  now = new Date(),
  unavailableAfterMs = PROX_OUTCOME_UNAVAILABLE_AFTER_MS,
}: {
  horizon: ProxOutcomeHorizon;
  targetAt: string;
  bars: ProxOutcomeBar[];
  now?: Date;
  unavailableAfterMs?: number;
}): ProxResolvedHorizon {
  const targetMs = new Date(targetAt).getTime();
  if (!Number.isFinite(targetMs) || targetMs > now.getTime()) {
    return {
      horizon,
      targetAt,
      state: "pending",
      measuredAt: null,
      measuredPrice: null,
      unavailableReason: null,
    };
  }
  const bar = findProxOutcomeBarAtTarget(bars, targetAt);
  if (bar) {
    return {
      horizon,
      targetAt,
      state: "measured",
      measuredAt: new Date(bar.timeMs).toISOString(),
      measuredPrice: bar.close,
      unavailableReason: null,
    };
  }
  if (now.getTime() - targetMs >= unavailableAfterMs) {
    return {
      horizon,
      targetAt,
      state: "unavailable",
      measuredAt: null,
      measuredPrice: null,
      unavailableReason: "No verified market bar exists near the target timestamp.",
    };
  }
  return {
    horizon,
    targetAt,
    state: "pending",
    measuredAt: null,
    measuredPrice: null,
    unavailableReason: null,
  };
}

export function summarizeProxOutcomePath({
  bars,
  entryPrice,
  decisionAt,
  through = new Date(),
}: {
  bars: ProxOutcomeBar[];
  entryPrice: number;
  decisionAt: string;
  through?: Date;
}) {
  const decisionMs = new Date(decisionAt).getTime();
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(decisionMs)) {
    return null;
  }
  const eligible = normalizeProxOutcomeBars(bars).filter(
    (bar) => bar.timeMs >= decisionMs && bar.timeMs <= through.getTime(),
  );
  if (eligible.length === 0) return null;
  const highest = eligible.reduce((best, bar) =>
    bar.high > best.high ? bar : best,
  );
  const lowest = eligible.reduce((best, bar) =>
    bar.low < best.low ? bar : best,
  );
  return {
    latest: eligible.at(-1)!,
    highest,
    lowest,
    maxGainPercent: ((highest.high - entryPrice) / entryPrice) * 100,
    maxDrawdownPercent: ((lowest.low - entryPrice) / entryPrice) * 100,
    timeToPeakMinutes: Math.max(0, (highest.timeMs - decisionMs) / 60_000),
  };
}
