// Target-path research is a downstream evaluator only. It cannot change an
// Agent plan, Canonical score/rank, ProX opinion, Paper order, or execution.

import { createHash } from "node:crypto";

export const HT_AGENT_TARGET_RESEARCH_VERSION =
  "ht-agent-target-path-research-v1";

export type HtAgentTargetResearchEpisode = {
  id: string;
  decisionId: string;
  symbol: string;
  horizon: "15m" | "60m" | "session";
  validFrom: string;
  targetAt: string;
  leastFavorableEntry: number;
  triggerPrice: number;
  stopPrice: number;
  targetOne: number;
  targetTwo: number | null;
};

export type HtAgentTargetResearchBar = {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type HtAgentTargetResearchResult = {
  episodeId: string;
  version: typeof HT_AGENT_TARGET_RESEARCH_VERSION;
  resolutionState: "measured" | "ambiguous" | "unavailable";
  outcomeCode:
    | "target_two_before_stop"
    | "target_one_before_stop"
    | "target_one_then_stop"
    | "stop_before_target"
    | "invalidated_before_entry"
    | "expired_after_entry"
    | "expired_untriggered"
    | "ambiguous_entry_candle"
    | "ambiguous_target_stop_candle"
    | "insufficient_provider_coverage";
  entryTriggeredAt: string | null;
  targetOneReachedAt: string | null;
  targetTwoReachedAt: string | null;
  stopReachedAt: string | null;
  postEntryMaximumHigh: number | null;
  postEntryMinimumLow: number | null;
  maximumFavorableExcursionPercent: number | null;
  maximumAdverseExcursionPercent: number | null;
  expectedIntervalCount: number;
  providerBarCount: number;
  coveragePercent: number;
  firstProviderBarAt: string | null;
  lastProviderBarAt: string | null;
  evidenceHash: string;
  reason: string;
  authority: {
    canonicalDecision: false;
    canonicalRanking: false;
    agentDecision: false;
    paperExecution: false;
    liveExecution: false;
  };
};

export type HtAgentTargetResearchRange = {
  fromMs: number;
  toMs: number;
};

type HtAgentTargetResearchBase = Pick<
  HtAgentTargetResearchResult,
  | "episodeId"
  | "version"
  | "expectedIntervalCount"
  | "providerBarCount"
  | "coveragePercent"
  | "firstProviderBarAt"
  | "lastProviderBarAt"
  | "evidenceHash"
  | "authority"
>;

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function validBar(bar: HtAgentTargetResearchBar) {
  return Number.isFinite(bar.timeMs) &&
    finitePositive(bar.open) !== null &&
    finitePositive(bar.high) !== null &&
    finitePositive(bar.low) !== null &&
    finitePositive(bar.close) !== null &&
    bar.high >= Math.max(bar.open, bar.close, bar.low) &&
    bar.low <= Math.min(bar.open, bar.close, bar.high);
}

function hashEvidence(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function extendExistingOutcomeRangesForTargetResearch(
  sourceRanges: Map<string, HtAgentTargetResearchRange>,
  episodes: HtAgentTargetResearchEpisode[],
) {
  const ranges = new Map(sourceRanges);
  const eligibleEpisodes: HtAgentTargetResearchEpisode[] = [];
  for (const episode of episodes) {
    const existing = ranges.get(episode.symbol);
    const fromMs = Date.parse(episode.validFrom);
    const toMs = Date.parse(episode.targetAt);
    if (!existing || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
    ranges.set(episode.symbol, {
      fromMs: Math.min(existing.fromMs, fromMs),
      toMs: Math.max(existing.toMs, toMs),
    });
    eligibleEpisodes.push(episode);
  }
  return {
    ranges,
    eligibleEpisodes,
    providerRequestsAdded: 0 as const,
  };
}

function baseResult(
  episode: HtAgentTargetResearchEpisode,
  bars: HtAgentTargetResearchBar[],
): HtAgentTargetResearchBase {
  const validFromMs = Date.parse(episode.validFrom);
  const targetAtMs = Date.parse(episode.targetAt);
  const expectedIntervalCount = Math.max(
    0,
    Math.ceil((targetAtMs - validFromMs) / 60_000),
  );
  const providerBarCount = bars.length;
  const coveragePercent = expectedIntervalCount > 0
    ? Math.min(100, providerBarCount / expectedIntervalCount * 100)
    : 0;
  return {
    episodeId: episode.id,
    version: HT_AGENT_TARGET_RESEARCH_VERSION,
    expectedIntervalCount,
    providerBarCount,
    coveragePercent: round(coveragePercent, 2),
    firstProviderBarAt: bars.length
      ? new Date(bars[0].timeMs).toISOString()
      : null,
    lastProviderBarAt: bars.length
      ? new Date(bars[bars.length - 1].timeMs).toISOString()
      : null,
    evidenceHash: hashEvidence({
      episodeId: episode.id,
      validFrom: episode.validFrom,
      targetAt: episode.targetAt,
      bars,
    }),
    authority: {
      canonicalDecision: false as const,
      canonicalRanking: false as const,
      agentDecision: false as const,
      paperExecution: false as const,
      liveExecution: false as const,
    },
  };
}

export function evaluateHtAgentTargetResearch(
  episode: HtAgentTargetResearchEpisode,
  sourceBars: HtAgentTargetResearchBar[],
): HtAgentTargetResearchResult {
  const validFromMs = Date.parse(episode.validFrom);
  const targetAtMs = Date.parse(episode.targetAt);
  const levels = [
    episode.leastFavorableEntry,
    episode.triggerPrice,
    episode.stopPrice,
    episode.targetOne,
  ];
  if (
    !Number.isFinite(validFromMs) ||
    !Number.isFinite(targetAtMs) ||
    targetAtMs <= validFromMs ||
    levels.some((value) => finitePositive(value) === null) ||
    episode.stopPrice >= episode.leastFavorableEntry ||
    episode.triggerPrice > episode.leastFavorableEntry ||
    episode.targetOne <= episode.leastFavorableEntry ||
    (episode.targetTwo !== null && episode.targetTwo <= episode.targetOne)
  ) {
    throw new Error("Invalid HT Agent target research episode.");
  }

  const bars = sourceBars
    .filter(validBar)
    .filter((bar) => bar.timeMs >= validFromMs && bar.timeMs < targetAtMs)
    .sort((left, right) => left.timeMs - right.timeMs)
    .filter((bar, index, all) => index === 0 || bar.timeMs !== all[index - 1].timeMs);
  const common = baseResult(episode, bars);
  let entryTriggeredAt: string | null = null;
  let targetOneReachedAt: string | null = null;
  let targetTwoReachedAt: string | null = null;
  let stopReachedAt: string | null = null;
  let postEntryMaximumHigh = Number.NEGATIVE_INFINITY;
  let postEntryMinimumLow = Number.POSITIVE_INFINITY;
  let maximumFavorableExcursionPercent = Number.NEGATIVE_INFINITY;
  let maximumAdverseExcursionPercent = Number.POSITIVE_INFINITY;

  for (const bar of bars) {
    const providerAt = new Date(bar.timeMs + 60_000).toISOString();
    const touchesTrigger = bar.high >= episode.leastFavorableEntry;
    const touchesStop = bar.low <= episode.stopPrice;
    const touchesTargetOne = bar.high >= episode.targetOne;
    const touchesTargetTwo = episode.targetTwo !== null && bar.high >= episode.targetTwo;

    if (entryTriggeredAt === null) {
      if (touchesTrigger && (touchesStop || touchesTargetOne)) {
        return {
          ...common,
          resolutionState: "ambiguous",
          outcomeCode: "ambiguous_entry_candle",
          entryTriggeredAt: null,
          targetOneReachedAt: null,
          targetTwoReachedAt: null,
          stopReachedAt: touchesStop ? providerAt : null,
          postEntryMaximumHigh: null,
          postEntryMinimumLow: null,
          maximumFavorableExcursionPercent: null,
          maximumAdverseExcursionPercent: null,
          reason: "The first trigger candle also crossed a stop or target, so intraminute ordering is unknowable.",
        };
      }
      if (touchesStop) {
        return {
          ...common,
          resolutionState: "measured",
          outcomeCode: "invalidated_before_entry",
          entryTriggeredAt: null,
          targetOneReachedAt: null,
          targetTwoReachedAt: null,
          stopReachedAt: providerAt,
          postEntryMaximumHigh: null,
          postEntryMinimumLow: null,
          maximumFavorableExcursionPercent: null,
          maximumAdverseExcursionPercent: null,
          reason: "The setup invalidated before its entry trigger was observed.",
        };
      }
      if (!touchesTrigger) continue;
      entryTriggeredAt = providerAt;
      continue;
    }

    postEntryMaximumHigh = Math.max(postEntryMaximumHigh, bar.high);
    postEntryMinimumLow = Math.min(postEntryMinimumLow, bar.low);
    maximumFavorableExcursionPercent = Math.max(
      maximumFavorableExcursionPercent,
      (bar.high - episode.leastFavorableEntry) /
        episode.leastFavorableEntry * 100,
    );
    maximumAdverseExcursionPercent = Math.min(
      maximumAdverseExcursionPercent,
      (bar.low - episode.leastFavorableEntry) /
        episode.leastFavorableEntry * 100,
    );

    const unresolvedTargetOne = targetOneReachedAt === null;
    if (touchesStop && (unresolvedTargetOne ? touchesTargetOne : touchesTargetTwo)) {
      return {
        ...common,
        resolutionState: "ambiguous",
        outcomeCode: "ambiguous_target_stop_candle",
        entryTriggeredAt,
        targetOneReachedAt,
        targetTwoReachedAt: null,
        stopReachedAt: providerAt,
        postEntryMaximumHigh: round(postEntryMaximumHigh, 6),
        postEntryMinimumLow: round(postEntryMinimumLow, 6),
        maximumFavorableExcursionPercent: round(maximumFavorableExcursionPercent),
        maximumAdverseExcursionPercent: round(maximumAdverseExcursionPercent),
        reason: "A completed minute crossed both the next unresolved target and the stop, so ordering is unknowable.",
      };
    }
    if (touchesStop) {
      stopReachedAt = providerAt;
      return {
        ...common,
        resolutionState: "measured",
        outcomeCode: targetOneReachedAt === null
          ? "stop_before_target"
          : "target_one_then_stop",
        entryTriggeredAt,
        targetOneReachedAt,
        targetTwoReachedAt,
        stopReachedAt,
        postEntryMaximumHigh: round(postEntryMaximumHigh, 6),
        postEntryMinimumLow: round(postEntryMinimumLow, 6),
        maximumFavorableExcursionPercent: round(maximumFavorableExcursionPercent),
        maximumAdverseExcursionPercent: round(maximumAdverseExcursionPercent),
        reason: targetOneReachedAt === null
          ? "The stop was observed before Target 1."
          : "Target 1 was observed before a later stop; Target 2 was not reached.",
      };
    }
    if (touchesTargetTwo) {
      targetOneReachedAt ??= providerAt;
      targetTwoReachedAt = providerAt;
      return {
        ...common,
        resolutionState: "measured",
        outcomeCode: "target_two_before_stop",
        entryTriggeredAt,
        targetOneReachedAt,
        targetTwoReachedAt,
        stopReachedAt,
        postEntryMaximumHigh: round(postEntryMaximumHigh, 6),
        postEntryMinimumLow: round(postEntryMinimumLow, 6),
        maximumFavorableExcursionPercent: round(maximumFavorableExcursionPercent),
        maximumAdverseExcursionPercent: round(maximumAdverseExcursionPercent),
        reason: "Target 2 was observed before the stop.",
      };
    }
    if (touchesTargetOne && targetOneReachedAt === null) {
      targetOneReachedAt = providerAt;
      if (episode.targetTwo === null) {
        return {
          ...common,
          resolutionState: "measured",
          outcomeCode: "target_one_before_stop",
          entryTriggeredAt,
          targetOneReachedAt,
          targetTwoReachedAt,
          stopReachedAt,
          postEntryMaximumHigh: round(postEntryMaximumHigh, 6),
          postEntryMinimumLow: round(postEntryMinimumLow, 6),
          maximumFavorableExcursionPercent: round(maximumFavorableExcursionPercent),
          maximumAdverseExcursionPercent: round(maximumAdverseExcursionPercent),
          reason: "Target 1 was observed before the stop.",
        };
      }
    }
  }

  if (entryTriggeredAt === null) {
    return {
      ...common,
      resolutionState: "measured",
      outcomeCode: "expired_untriggered",
      entryTriggeredAt: null,
      targetOneReachedAt: null,
      targetTwoReachedAt: null,
      stopReachedAt: null,
      postEntryMaximumHigh: null,
      postEntryMinimumLow: null,
      maximumFavorableExcursionPercent: null,
      maximumAdverseExcursionPercent: null,
      reason: "The entry trigger was not observed before the fixed research horizon expired.",
    };
  }
  return {
    ...common,
    resolutionState: "measured",
    outcomeCode: targetOneReachedAt === null
      ? "expired_after_entry"
      : "target_one_before_stop",
    entryTriggeredAt,
    targetOneReachedAt,
    targetTwoReachedAt,
    stopReachedAt,
    postEntryMaximumHigh: Number.isFinite(postEntryMaximumHigh)
      ? round(postEntryMaximumHigh, 6)
      : null,
    postEntryMinimumLow: Number.isFinite(postEntryMinimumLow)
      ? round(postEntryMinimumLow, 6)
      : null,
    maximumFavorableExcursionPercent: Number.isFinite(maximumFavorableExcursionPercent)
      ? round(maximumFavorableExcursionPercent)
      : null,
    maximumAdverseExcursionPercent: Number.isFinite(maximumAdverseExcursionPercent)
      ? round(maximumAdverseExcursionPercent)
      : null,
    reason: targetOneReachedAt === null
      ? "The entry triggered, but Target 1 and the stop were not observed before expiry."
      : "Target 1 was observed before the stop; Target 2 was not observed before expiry.",
  };
}
