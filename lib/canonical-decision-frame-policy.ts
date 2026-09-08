// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { ACTIVE_MARKET_DATA_MAX_AGE_MS, isActiveMarketTimestampUsable, marketTimestampMs } from "./market-data-time.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { PROX_UNAVAILABLE_MARKET_ADJUSTMENT } from "./prox/public-authority.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { getLastCompletedStockSessionDate, getStockMarketClock, stockHistoryLabel } from "./stock-market-session.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { measureMarketTimestampAlignment } from "./market-data-time.ts";

export const CANONICAL_DECISION_FRAME_VERSION =
  "rolling-canonical-decision-frame-v6-scenario-integrity";
export const CANONICAL_DECISION_FRAME_REVALIDATE_SECONDS = 60;
export const CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS = 90;

export function getDecisionFrameFreshness(
  decisionAsOf: string | null | undefined,
  now = new Date(),
) {
  const decisionMs = decisionAsOf ? new Date(decisionAsOf).getTime() : NaN;
  const ageSeconds = Number.isFinite(decisionMs)
    ? Math.max(0, (now.getTime() - decisionMs) / 1_000)
    : Number.POSITIVE_INFINITY;
  return {
    ageSeconds,
    fresh: ageSeconds <= CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS,
    freshUntil: Number.isFinite(decisionMs)
      ? new Date(
          decisionMs + CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS * 1_000,
        ).toISOString()
      : null,
  };
}

type MarketTimedFrameOpportunity = {
  ticker?: unknown;
  sourceRunId?: unknown;
  scanSession?: unknown;
  decisionQuoteAsOf?: unknown;
  proxIntelligence?: {
    pulse?: { marketAsOf?: unknown } | null;
  } | null;
  scoreContext?: {
    proxMarketDataAligned?: unknown;
    proxMarketAdjustment?: unknown;
    proxSupportsContinuation?: unknown;
    peakFailureConfirmed?: unknown;
    proxDeepSessionRecoveryWithheld?: unknown;
    proxSevereSessionPeakDamage?: unknown;
  } | null;
};

const ACTIVE_MARKET_SESSIONS = new Set([
  "pre_market",
  "regular",
  "after_hours",
]);

export function getDecisionFrameMarketTimingFreshness(
  frame: {
    opportunities?: unknown;
    momentumContenders?: unknown;
  },
  now = new Date(),
) {
  // Closed-session display is a separate contract, never fresh entry evidence.
  if (!getStockMarketClock(now).active) return { fresh: false, freshUntil: null };
  const records = [
    Array.isArray(frame.opportunities) ? frame.opportunities[0] : null,
    ...(Array.isArray(frame.momentumContenders)
      ? frame.momentumContenders
      : []),
  ].filter(Boolean) as MarketTimedFrameOpportunity[];
  let earliestExpiryMs: number | null = null;

  for (const record of records) {
    // A saved "closed"/unknown session must not bypass today's active checks.
    if (!ACTIVE_MARKET_SESSIONS.has(String(record.scanSession ?? ""))) return { fresh: false, freshUntil: null };
    const decisionQuoteMs = marketTimestampMs(record.decisionQuoteAsOf);
    const proxMarketMs = marketTimestampMs(
      record.proxIntelligence?.pulse?.marketAsOf,
    );
    if (
      !isActiveMarketTimestampUsable(record.decisionQuoteAsOf, now) ||
      decisionQuoteMs === null
    ) {
      return { fresh: false, freshUntil: null };
    }
    const proxTemporalAuthorityReady = Boolean(
      isActiveMarketTimestampUsable(
        record.proxIntelligence?.pulse?.marketAsOf,
        now,
      ) &&
        record.scoreContext?.proxMarketDataAligned === true &&
        proxMarketMs !== null,
    );
    // The provider-time contract permits a missing/stale/misaligned pulse only
    // through the documented fail-closed lane: the exact bounded penalty is
    // applied, while support and every defensive authority action remain off.
    // This is not a neutral pass and stale ProX facts still cannot act.
    const proxFailClosed = Boolean(
      Number(record.scoreContext?.proxMarketAdjustment) ===
        PROX_UNAVAILABLE_MARKET_ADJUSTMENT &&
        record.scoreContext?.proxSupportsContinuation === false &&
        record.scoreContext?.peakFailureConfirmed === false &&
        record.scoreContext?.proxDeepSessionRecoveryWithheld === false &&
        record.scoreContext?.proxSevereSessionPeakDamage === false,
    );
    if (!proxTemporalAuthorityReady && !proxFailClosed) {
      return { fresh: false, freshUntil: null };
    }
    const recordExpiryMs = proxTemporalAuthorityReady
      ? Math.min(
          decisionQuoteMs + ACTIVE_MARKET_DATA_MAX_AGE_MS,
          (proxMarketMs as number) + ACTIVE_MARKET_DATA_MAX_AGE_MS,
        )
      : decisionQuoteMs + ACTIVE_MARKET_DATA_MAX_AGE_MS;
    earliestExpiryMs =
      earliestExpiryMs === null
        ? recordExpiryMs
        : Math.min(earliestExpiryMs, recordExpiryMs);
  }

  return {
    fresh: true,
    freshUntil:
      earliestExpiryMs === null
        ? null
        : new Date(earliestExpiryMs).toISOString(),
  };
}

type RetainableFrame = {
  sourceRun?: { id?: unknown; completedAt?: unknown };
  opportunities?: unknown;
  momentumContenders?: unknown;
};

/** Display-only verification. It does not grant freshness or Agent authority,
 * change a score, reconstruct history, or assert old ProX evidence is live. */
export function getRetainedSessionIntegrity(frame: RetainableFrame, now = new Date()) {
  const currentSession = getStockMarketClock(now).session;
  const expectedSessionDate = getLastCompletedStockSessionDate(now);
  const runMs = marketTimestampMs(frame.sourceRun?.completedAt);
  const sourceSessionDate = runMs === null ? null : getStockMarketClock(new Date(runMs)).easternDate;
  const records = [
    Array.isArray(frame.opportunities) ? frame.opportunities[0] : null,
    ...(Array.isArray(frame.momentumContenders) ? frame.momentumContenders : []),
  ].filter(Boolean) as MarketTimedFrameOpportunity[];
  const issues: string[] = [];
  const unalignedProxTickers: string[] = [];
  if (currentSession !== "closed") issues.push("market_is_active");
  if (!frame.sourceRun?.id || runMs === null || runMs > now.getTime()) issues.push("missing_or_future_source_run");
  if (!expectedSessionDate || sourceSessionDate !== expectedSessionDate) issues.push("source_run_not_latest_session");
  if (!records.length) issues.push("missing_retained_records");
  const providerTimes: number[] = [];
  for (const record of records) {
    const ticker = String(record.ticker ?? "UNKNOWN");
    const providerMs = marketTimestampMs(record.decisionQuoteAsOf);
    const providerClock = providerMs === null ? null : getStockMarketClock(new Date(providerMs));
    if (record.sourceRunId !== frame.sourceRun?.id) issues.push(`${ticker}:source_run_mismatch`);
    if (!ACTIVE_MARKET_SESSIONS.has(String(record.scanSession ?? "")) || providerMs === null ||
        providerMs > now.getTime() || !providerClock?.active || providerClock.easternDate !== expectedSessionDate) {
      issues.push(`${ticker}:invalid_retained_provider_time`);
    } else providerTimes.push(providerMs);
    const proxMs = marketTimestampMs(record.proxIntelligence?.pulse?.marketAsOf);
    const proxClock = proxMs === null ? null : getStockMarketClock(new Date(proxMs));
    const alignment = measureMarketTimestampAlignment(record.decisionQuoteAsOf, record.proxIntelligence?.pulse?.marketAsOf);
    if (!alignment.aligned || proxMs === null || proxMs > now.getTime() ||
        !proxClock?.active || proxClock.easternDate !== expectedSessionDate) {
      unalignedProxTickers.push(ticker);
      const context = record.scoreContext;
      const hasNoProxAuthority = (context?.proxMarketAdjustment === 0 || context?.proxMarketAdjustment === PROX_UNAVAILABLE_MARKET_ADJUSTMENT) &&
        context?.proxSupportsContinuation === false && context?.peakFailureConfirmed === false &&
        context?.proxDeepSessionRecoveryWithheld === false && context?.proxSevereSessionPeakDamage === false;
      if (!hasNoProxAuthority) issues.push(`${ticker}:unaligned_prox_authority`);
    }
  }
  return {
    valid: issues.length === 0, currentSession, sourceSessionDate, expectedSessionDate,
    label: stockHistoryLabel(typeof frame.sourceRun?.completedAt === "string" ? frame.sourceRun.completedAt : null, now),
    sourceRunId: frame.sourceRun?.id ?? null,
    oldestProviderAsOf: providerTimes.length ? new Date(Math.min(...providerTimes)).toISOString() : null,
    newestProviderAsOf: providerTimes.length ? new Date(Math.max(...providerTimes)).toISOString() : null,
    unalignedProxTickers, issues,
  };
}

// Run this after the cache read as well: a response built just before 8 PM
// must not carry its saved Live label across the close. Values/ranks stay intact.
export function presentCanonicalSessionRecord<T extends { decisionQuoteAsOf?: unknown }>(record: T, now = new Date()): T {
  if (getStockMarketClock(now).active) return record;
  return { ...record, displayQuoteLive: false,
    freshnessLabel: stockHistoryLabel(typeof record.decisionQuoteAsOf === "string" ? record.decisionQuoteAsOf : null, now) };
}

type FrameOpportunity = { ticker?: unknown } & Record<string, unknown>;

export function findOpportunityInDecisionFrame(
  frame: {
    opportunities?: unknown;
    momentumContenders?: unknown;
    momentumRadar?: unknown;
  },
  ticker: string,
) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const collections = [
    frame.opportunities,
    frame.momentumContenders,
    frame.momentumRadar,
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    const match = (collection as FrameOpportunity[]).find(
      (opportunity) =>
        String(opportunity.ticker ?? "").trim().toUpperCase() ===
        normalizedTicker,
    );
    if (match) return match;
  }
  return null;
}
