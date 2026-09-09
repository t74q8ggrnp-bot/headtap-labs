// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { easternDateString, mergeMarketBars, summarizeMarketBars, type MarketChartBar, type MarketChartDisplayQuote, type MarketChartResponse } from "./market-chart.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getStockMarketClock, type StockMarketSession } from "./stock-market-session.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { marketSessionIsDisplayed, mergeSharedDisplayPriceIntoCurrentCandle } from "./market-chart-timeframes.ts";

export const MARKET_CHART_FEED_VERSION = "market-chart-feed-v1" as const;

export type MarketChartSessionScope = "regular" | "extended";

export type MarketProviderRequestKind =
  | "minute_history"
  | "second_delta"
  | "snapshot"
  | "last_trade";

export type MarketProviderEvidenceDelivery =
  | "provider"
  | "single_flight"
  | "ttl_cache";

export type MarketProviderRequestReceipt = {
  kind: MarketProviderRequestKind;
  /** True only when this server request initiated a call to Massive. */
  attempted: boolean;
  /** True only when that initiated provider call returned usable evidence. */
  succeeded: boolean;
  /** How this server request received the evidence it evaluated. */
  delivery: MarketProviderEvidenceDelivery;
  /** Whether usable evidence was available, including safe reuse. */
  evidenceAccepted: boolean;
  /** Age of reused evidence when this server request received it. */
  evidenceAgeMs: number;
};

export type MarketChartRequestInstrumentation = {
  architecture: typeof MARKET_CHART_FEED_VERSION;
  phase: "bootstrap" | "delta";
  requestId: string;
  requestStartedAt: string;
  responseCompletedAt: string;
  durationMs: number;
  providerRequestCount: number;
  acceptedEvidenceCount: number;
  reusedEvidenceCount: number;
  legacyEquivalentRequestCount: number;
  comparisonBasis: "legacy-four-call-refresh-v1";
  requests: MarketProviderRequestReceipt[];
};

export type MarketChartSessionAuthority = {
  sessionScope: MarketChartSessionScope;
  displayedSessionDate: string;
  providerTimestamp: string | null;
  providerSession: StockMarketSession | null;
  candleIntervalTimestamp: string | null;
  displayPriceAppliedToCandle: boolean;
  reason:
    | "aligned"
    | "provider_timestamp_missing"
    | "outside_displayed_session"
    | "outside_session_scope";
};

export type MarketChartBootstrapResponse = MarketChartResponse & {
  feedVersion: typeof MARKET_CHART_FEED_VERSION;
  feedPhase: "bootstrap";
  previousClose: number | null;
  sessionAuthority: MarketChartSessionAuthority;
  instrumentation: MarketChartRequestInstrumentation;
};

export type MarketChartDeltaResponse = {
  success: true;
  asset: "stock";
  symbol: string;
  feedVersion: typeof MARKET_CHART_FEED_VERSION;
  feedPhase: "delta";
  bars: MarketChartBar[];
  displayQuote: MarketChartDisplayQuote;
  latestAt: string;
  intervalSeconds: 60;
  sessionAuthority: MarketChartSessionAuthority;
  /** REST polling telemetry. A future authenticated stream may omit it. */
  instrumentation?: MarketChartRequestInstrumentation;
};

export type MarketChartFeedFrame = {
  chart: MarketChartResponse;
  previousClose: number | null;
  receivedAt: number;
  sessionAuthority: MarketChartSessionAuthority;
  instrumentation: {
    bootstrapProviderRequests: number;
    deltaProviderRequests: number;
    totalProviderRequests: number;
    acceptedEvidenceCount: number;
    reusedEvidenceCount: number;
    comparablePollingFrames: number;
    legacyEquivalentRequests: number;
  };
};

export type MarketChartFeedRequest = {
  asset: "stock";
  symbol: string;
  sessionScope?: MarketChartSessionScope;
  displayedSessionDate?: string;
};

export function marketChartFeedFrameForSymbol(
  frame: MarketChartFeedFrame | null,
  symbol: string,
) {
  return frame?.chart.asset === "stock" &&
      frame.chart.symbol === symbol.trim().toUpperCase()
    ? frame
    : null;
}

export type MarketChartTransport = {
  loadBootstrap: (
    request: MarketChartFeedRequest,
    signal?: AbortSignal,
  ) => Promise<MarketChartBootstrapResponse>;
  subscribe: (
    request: MarketChartFeedRequest,
    listener: (delta: MarketChartDeltaResponse) => void,
    onError?: (error: unknown) => void,
  ) => () => void;
  /**
   * Optional server-anchored presentation clock. Polling and a future socket
   * transport can provide this without coupling chart components to either
   * delivery mechanism.
   */
  trustedNow?: () => number;
  acceptTrustedTime?: (
    value: string | number | Date | null | undefined,
  ) => boolean;
};

export function marketChartTransportNow(transport: MarketChartTransport) {
  const candidate = transport.trustedNow?.();
  return Number.isFinite(candidate) ? Number(candidate) : Date.now();
}

/**
 * Return a minute-aligned start for a window containing `minuteBuckets`
 * aggregate buckets, including the current in-progress minute. Starting from
 * an arbitrary rolling timestamp would create a partial first bucket that can
 * overwrite a complete historical candle during a merge.
 */
export function marketChartSecondAggregateWindowStart(
  timestampMs: number,
  minuteBuckets: number,
) {
  if (!Number.isFinite(timestampMs) || !Number.isSafeInteger(minuteBuckets) || minuteBuckets < 1) {
    throw new RangeError("A valid timestamp and positive minute bucket count are required.");
  }
  const currentMinute = Math.floor(timestampMs / 60_000) * 60_000;
  return currentMinute - (minuteBuckets - 1) * 60_000;
}

/** Keep aggregate evidence inside the immutable provider-time frame. */
export function marketBarsAtOrBeforeProviderTimestamp(
  bars: readonly MarketChartBar[],
  providerTimestamp: string | null | undefined,
  bucketSeconds = 1,
) {
  const providerMs = providerTimestamp ? Date.parse(providerTimestamp) : Number.NaN;
  if (!Number.isFinite(providerMs) || !Number.isFinite(bucketSeconds) || bucketSeconds <= 0) {
    return [];
  }
  // Only accept completed aggregate buckets. The provider-time last trade is
  // applied separately, so including its in-progress second/minute could leak
  // trades that occurred after the database-selected display frame.
  return bars.filter(
    (bar) => (bar.time + bucketSeconds) * 1_000 <= providerMs,
  );
}

function validMarketChartBar(value: unknown): value is MarketChartBar {
  if (!value || typeof value !== "object") return false;
  const bar = value as Partial<MarketChartBar>;
  return [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) &&
    Number(bar.time) > 0 &&
    [bar.open, bar.high, bar.low, bar.close].every((price) => Number(price) > 0) &&
    Number(bar.high) >= Math.max(Number(bar.open), Number(bar.close), Number(bar.low)) &&
    Number(bar.low) <= Math.min(Number(bar.open), Number(bar.close), Number(bar.high)) &&
    Number(bar.volume) >= 0;
}

function validOrderedMarketChartBars(value: unknown): value is MarketChartBar[] {
  if (!Array.isArray(value) || !value.every(validMarketChartBar)) return false;
  return value.every((bar, index) => index === 0 || bar.time > value[index - 1].time);
}

const MARKET_CHART_FUTURE_TOLERANCE_MS = 2_000;

/**
 * The transport boundary owns the shape of the shared stock quote. Components
 * must never infer truth from JavaScript coercion (for example, the string
 * `"false"` becoming a truthy Live label). When REST telemetry is present,
 * compare provider time with the trusted server completion clock—not a phone
 * or desktop wall clock that may be skewed.
 */
function validStockMarketChartDisplayQuote(
  value: unknown,
  trustedServerAt?: number,
): value is MarketChartDisplayQuote {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<MarketChartDisplayQuote>;
  const providerAt = Date.parse(quote.asOf ?? "");
  const validChange = quote.changePercent === null ||
    Number.isFinite(quote.changePercent);
  const validSource = quote.source === "massive_polygon_last_trade" ||
    quote.source === "massive_polygon_snapshot";
  const validPriceKind = quote.priceKind === "trade" ||
    quote.priceKind === "minute_aggregate";
  const validChangeBasis = quote.changeBasis === undefined ||
    quote.changeBasis === "previous_close" ||
    quote.changeBasis === "chart_open";

  return Number.isFinite(quote.price) &&
    Number(quote.price) > 0 &&
    validChange &&
    Number.isFinite(providerAt) &&
    (!Number.isFinite(trustedServerAt) ||
      providerAt <= Number(trustedServerAt) + MARKET_CHART_FUTURE_TOLERANCE_MS) &&
    typeof quote.live === "boolean" &&
    validSource &&
    validPriceKind &&
    validChangeBasis;
}

function validInstrumentation(
  value: unknown,
  phase: "bootstrap" | "delta",
): value is MarketChartRequestInstrumentation {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<MarketChartRequestInstrumentation>;
  const requests = receipt.requests;
  const expectedKinds: MarketProviderRequestKind[] = phase === "bootstrap"
    ? ["minute_history", "second_delta", "snapshot", "last_trade"]
    : ["second_delta", "last_trade"];
  const validRequests = Array.isArray(requests) &&
    requests.length === expectedKinds.length &&
    requests.every((request, index) =>
      request &&
      typeof request === "object" &&
      request.kind === expectedKinds[index] &&
      typeof request.attempted === "boolean" &&
      typeof request.succeeded === "boolean" &&
      (request.delivery === "provider" ||
        request.delivery === "single_flight" ||
        request.delivery === "ttl_cache") &&
      typeof request.evidenceAccepted === "boolean" &&
      Number.isFinite(request.evidenceAgeMs) &&
      Number(request.evidenceAgeMs) >= 0 &&
      (!request.succeeded || request.attempted) &&
      (request.delivery === "provider") === request.attempted &&
      (request.delivery === "provider" || !request.succeeded)
    );
  const startedAt = Date.parse(receipt.requestStartedAt ?? "");
  const completedAt = Date.parse(receipt.responseCompletedAt ?? "");
  const attemptedCount = validRequests
    ? requests.filter((request) => request.attempted).length
    : -1;
  const acceptedCount = validRequests
    ? requests.filter((request) => request.evidenceAccepted).length
    : -1;
  const reusedCount = validRequests
    ? requests.filter((request) =>
        request.evidenceAccepted && request.delivery !== "provider"
      ).length
    : -1;
  return receipt.architecture === MARKET_CHART_FEED_VERSION &&
    receipt.phase === phase &&
    typeof receipt.requestId === "string" &&
    receipt.requestId.length > 0 &&
    Number.isFinite(startedAt) &&
    Number.isFinite(completedAt) &&
    completedAt >= startedAt &&
    Number.isFinite(receipt.durationMs) &&
    Number(receipt.durationMs) >= 0 &&
    Number.isSafeInteger(receipt.providerRequestCount) &&
    receipt.providerRequestCount === attemptedCount &&
    Number.isSafeInteger(receipt.acceptedEvidenceCount) &&
    receipt.acceptedEvidenceCount === acceptedCount &&
    Number.isSafeInteger(receipt.reusedEvidenceCount) &&
    receipt.reusedEvidenceCount === reusedCount &&
    receipt.legacyEquivalentRequestCount === 4 &&
    receipt.comparisonBasis === "legacy-four-call-refresh-v1" &&
    validRequests;
}

function authorityMatchesProviderQuote(
  authority: MarketChartSessionAuthority,
  quote: MarketChartDisplayQuote,
) {
  if (authority.providerTimestamp !== quote.asOf) return false;
  const expected = resolveMarketChartSessionAuthority({
    providerTimestamp: quote.asOf,
    displayedSessionDate: authority.displayedSessionDate,
    sessionScope: authority.sessionScope,
    intervalSeconds: 60,
  });
  return expected.providerSession === authority.providerSession &&
    expected.candleIntervalTimestamp === authority.candleIntervalTimestamp &&
    expected.displayPriceAppliedToCandle === authority.displayPriceAppliedToCandle &&
    expected.reason === authority.reason;
}

function deltaBarsMatchProviderFrame(
  bars: readonly MarketChartBar[],
  latestAt: string | undefined,
  authority: MarketChartSessionAuthority,
) {
  const candleTimestamp = authority.candleIntervalTimestamp
    ? Date.parse(authority.candleIntervalTimestamp) / 1_000
    : Number.NaN;
  const latestTimestamp = latestAt
    ? Date.parse(latestAt) / 1_000
    : Number.NaN;
  if (!Number.isFinite(candleTimestamp) || !Number.isFinite(latestTimestamp)) {
    return false;
  }

  if (
    marketChartBarsInDisplayedSession(
      bars,
      authority.displayedSessionDate,
      authority.sessionScope,
    ).length !== bars.length
  ) {
    return false;
  }

  // Delta bars are minute buckets. The newest bucket may still be in progress,
  // but it may never be later than the immutable provider-trade bucket that
  // owns this frame.
  if (bars.some((bar) => bar.time > candleTimestamp)) return false;
  const expectedLatest = bars.at(-1)?.time ?? candleTimestamp;
  return latestTimestamp === expectedLatest;
}

/** Runtime boundary for polling today and a socket transport later. */
export function validMarketChartDeltaResponse(
  value: unknown,
  request: MarketChartFeedRequest,
): value is MarketChartDeltaResponse {
  if (!value || typeof value !== "object") return false;
  const delta = value as Partial<MarketChartDeltaResponse>;
  const quote = delta.displayQuote;
  const authority = delta.sessionAuthority;
  const instrumentationValid = delta.instrumentation === undefined ||
    validInstrumentation(delta.instrumentation, "delta");
  const trustedServerAt = delta.instrumentation && instrumentationValid
    ? Date.parse(delta.instrumentation.responseCompletedAt)
    : undefined;
  return delta.success === true &&
    delta.asset === "stock" &&
    delta.symbol === request.symbol &&
    delta.feedVersion === MARKET_CHART_FEED_VERSION &&
    delta.feedPhase === "delta" &&
    delta.intervalSeconds === 60 &&
    validOrderedMarketChartBars(delta.bars) &&
    validStockMarketChartDisplayQuote(quote, trustedServerAt) &&
    Boolean(authority && authority.sessionScope === (request.sessionScope ?? "extended")) &&
    Boolean(authority && (!request.displayedSessionDate || authority.displayedSessionDate === request.displayedSessionDate)) &&
    Boolean(quote && authority && authorityMatchesProviderQuote(authority, quote)) &&
    Boolean(authority && deltaBarsMatchProviderFrame(delta.bars ?? [], delta.latestAt, authority)) &&
    Boolean(authority && marketChartFrameHasSharedPriceInvariant({
      bars: delta.bars ?? [],
      displayQuote: quote,
      sessionAuthority: authority,
    })) &&
    instrumentationValid;
}

export function marketChartFrameHasSharedPriceInvariant(input: {
  bars: readonly MarketChartBar[];
  displayQuote: MarketChartDisplayQuote | null | undefined;
  sessionAuthority: MarketChartSessionAuthority;
}) {
  if (!input.sessionAuthority.displayPriceAppliedToCandle) return true;
  const latest = input.bars.at(-1);
  const quote = input.displayQuote;
  const bucket = input.sessionAuthority.candleIntervalTimestamp
    ? Date.parse(input.sessionAuthority.candleIntervalTimestamp) / 1_000
    : Number.NaN;
  return Boolean(
    latest &&
    quote &&
    Number.isFinite(bucket) &&
    latest.time === bucket &&
    latest.close === quote.price,
  );
}

export function validMarketChartBootstrapResponse(
  value: unknown,
  request: MarketChartFeedRequest,
): value is MarketChartBootstrapResponse {
  if (!value || typeof value !== "object") return false;
  const bootstrap = value as Partial<MarketChartBootstrapResponse>;
  const quote = bootstrap.displayQuote;
  const authority = bootstrap.sessionAuthority;
  const instrumentationValid = validInstrumentation(
    bootstrap.instrumentation,
    "bootstrap",
  );
  const trustedServerAt = bootstrap.instrumentation && instrumentationValid
    ? Date.parse(bootstrap.instrumentation.responseCompletedAt)
    : undefined;
  return bootstrap.success === true &&
    bootstrap.asset === "stock" &&
    bootstrap.symbol === request.symbol &&
    bootstrap.feedVersion === MARKET_CHART_FEED_VERSION &&
    bootstrap.feedPhase === "bootstrap" &&
    bootstrap.intervalSeconds === 60 &&
    Number.isFinite(Date.parse(bootstrap.latestAt ?? "")) &&
    validOrderedMarketChartBars(bootstrap.bars) &&
    bootstrap.bars.length >= 1 &&
    validStockMarketChartDisplayQuote(quote, trustedServerAt) &&
    Boolean(authority && authority.sessionScope === (request.sessionScope ?? "extended")) &&
    Boolean(quote && authority && authorityMatchesProviderQuote(authority, quote)) &&
    Boolean(authority && deltaBarsMatchProviderFrame(
      bootstrap.bars ?? [],
      bootstrap.latestAt,
      authority,
    )) &&
    Boolean(authority && marketChartFrameHasSharedPriceInvariant({
      bars: bootstrap.bars ?? [],
      displayQuote: quote,
      sessionAuthority: authority,
    })) &&
    instrumentationValid;
}

/**
 * Validate an already-admitted, transport-neutral current stock frame. Legacy
 * chart consumers keep this shape between deltas, but must not revalidate a
 * newer quote against the original bootstrap receipt's completion timestamp.
 */
export function validCurrentMarketChartFrame(
  value: unknown,
  request: MarketChartFeedRequest,
  trustedServerAt?: number,
): value is MarketChartBootstrapResponse {
  if (!value || typeof value !== "object") return false;
  const current = value as Partial<MarketChartBootstrapResponse>;
  const quote = current.displayQuote;
  const authority = current.sessionAuthority;
  return current.success === true &&
    current.asset === "stock" &&
    current.symbol === request.symbol &&
    current.feedVersion === MARKET_CHART_FEED_VERSION &&
    current.feedPhase === "bootstrap" &&
    current.intervalSeconds === 60 &&
    Number.isFinite(Date.parse(current.latestAt ?? "")) &&
    validOrderedMarketChartBars(current.bars) &&
    Boolean(current.bars && current.bars.length >= 1) &&
    validStockMarketChartDisplayQuote(quote, trustedServerAt) &&
    Boolean(authority && authority.sessionScope === (request.sessionScope ?? "extended")) &&
    Boolean(authority && (!request.displayedSessionDate ||
      authority.displayedSessionDate === request.displayedSessionDate)) &&
    Boolean(quote && authority && authorityMatchesProviderQuote(authority, quote)) &&
    Boolean(authority && deltaBarsMatchProviderFrame(
      current.bars ?? [],
      current.latestAt,
      authority,
    )) &&
    Boolean(authority && marketChartFrameHasSharedPriceInvariant({
      bars: current.bars ?? [],
      displayQuote: quote,
      sessionAuthority: authority,
    }));
}

export function createProviderRequestInstrumentation(input: {
  phase: "bootstrap" | "delta";
  requests: Array<{
    kind: MarketProviderRequestKind;
    attempted: boolean;
    succeeded: boolean;
    delivery?: MarketProviderEvidenceDelivery;
    evidenceAccepted?: boolean;
    evidenceAgeMs?: number;
  }>;
  requestId?: string;
  requestStartedAt?: Date | string | number;
  responseCompletedAt?: Date | string | number;
}): MarketChartRequestInstrumentation {
  const completedMs = input.responseCompletedAt instanceof Date
    ? input.responseCompletedAt.getTime()
    : typeof input.responseCompletedAt === "string"
      ? Date.parse(input.responseCompletedAt)
      : input.responseCompletedAt ?? Date.now();
  const startedMs = input.requestStartedAt instanceof Date
    ? input.requestStartedAt.getTime()
    : typeof input.requestStartedAt === "string"
      ? Date.parse(input.requestStartedAt)
      : input.requestStartedAt ?? completedMs;
  const safeCompletedMs = Number.isFinite(completedMs) ? completedMs : Date.now();
  const safeStartedMs = Number.isFinite(startedMs) ? startedMs : safeCompletedMs;
  const requests: MarketProviderRequestReceipt[] = input.requests.map((request) => ({
    ...request,
    delivery: request.delivery ?? "provider",
    evidenceAccepted: request.evidenceAccepted ?? request.succeeded,
    evidenceAgeMs: Math.max(0, request.evidenceAgeMs ?? 0),
  }));
  return {
    architecture: MARKET_CHART_FEED_VERSION,
    phase: input.phase,
    requestId: input.requestId ?? `market-chart-${input.phase}-${safeStartedMs}`,
    requestStartedAt: new Date(safeStartedMs).toISOString(),
    responseCompletedAt: new Date(safeCompletedMs).toISOString(),
    durationMs: Math.max(0, safeCompletedMs - safeStartedMs),
    providerRequestCount: requests.filter((request) => request.attempted).length,
    acceptedEvidenceCount: requests.filter((request) => request.evidenceAccepted).length,
    reusedEvidenceCount: requests.filter((request) =>
      request.evidenceAccepted && request.delivery !== "provider"
    ).length,
    legacyEquivalentRequestCount: 4,
    comparisonBasis: "legacy-four-call-refresh-v1",
    requests,
  };
}

function candleBucketAt(providerTimestamp: string | null, intervalSeconds = 60) {
  if (!providerTimestamp) return null;
  const timestamp = Date.parse(providerTimestamp);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(
    Math.floor(timestamp / (intervalSeconds * 1_000)) * intervalSeconds * 1_000,
  ).toISOString();
}

export function stockSessionAllowedInChartScope(
  session: StockMarketSession,
  scope: MarketChartSessionScope,
) {
  return session !== "closed" && marketSessionIsDisplayed(session, scope);
}

/**
 * Keep transport bars inside the date and session promised by the response.
 * Consumers may defensively apply this again while merging, but the API itself
 * must never ship extended-hours candles in a regular-session delta.
 */
export function marketChartBarsInDisplayedSession(
  bars: readonly MarketChartBar[],
  displayedSessionDate: string,
  sessionScope: MarketChartSessionScope,
) {
  return bars.filter((bar) => {
    const clock = getStockMarketClock(new Date(bar.time * 1_000));
    return clock.easternDate === displayedSessionDate &&
      stockSessionAllowedInChartScope(clock.session, sessionScope);
  });
}

/**
 * Select the displayed session without confusing an older aggregate tail with
 * the timestamp authority of the newest verified trade. An in-scope first
 * print may start a provisional new-session candle; an out-of-scope print may
 * never advance a regular-only chart.
 */
export function resolveMarketChartDisplayedSessionDate(input: {
  latestAggregateTimestamp: string | null | undefined;
  providerTimestamp: string | null | undefined;
  sessionScope: MarketChartSessionScope;
  fallbackTimestamp?: Date | string | number;
}) {
  const aggregateMs = input.latestAggregateTimestamp
    ? Date.parse(input.latestAggregateTimestamp)
    : Number.NaN;
  const aggregateDate = Number.isFinite(aggregateMs)
    ? easternDateString(aggregateMs)
    : null;
  const providerMs = input.providerTimestamp
    ? Date.parse(input.providerTimestamp)
    : Number.NaN;
  const providerClock = Number.isFinite(providerMs)
    ? getStockMarketClock(new Date(providerMs))
    : null;
  const providerDate = providerClock?.easternDate ?? null;
  if (
    providerClock &&
    providerDate &&
    stockSessionAllowedInChartScope(providerClock.session, input.sessionScope) &&
    (!aggregateDate || providerDate >= aggregateDate)
  ) {
    return providerDate;
  }
  if (aggregateDate) return aggregateDate;
  if (providerDate) return providerDate;
  const fallback = input.fallbackTimestamp ?? Date.now();
  return easternDateString(
    fallback instanceof Date ? fallback : new Date(fallback),
  );
}

export function resolveMarketChartSessionAuthority(input: {
  providerTimestamp: string | null | undefined;
  displayedSessionDate: string;
  sessionScope: MarketChartSessionScope;
  intervalSeconds?: number;
}): MarketChartSessionAuthority {
  const providerMs = input.providerTimestamp
    ? Date.parse(input.providerTimestamp)
    : Number.NaN;
  if (!Number.isFinite(providerMs)) {
    return {
      sessionScope: input.sessionScope,
      displayedSessionDate: input.displayedSessionDate,
      providerTimestamp: null,
      providerSession: null,
      candleIntervalTimestamp: null,
      displayPriceAppliedToCandle: false,
      reason: "provider_timestamp_missing",
    };
  }

  const providerTimestamp = new Date(providerMs).toISOString();
  const providerClock = getStockMarketClock(new Date(providerMs));
  const candleIntervalTimestamp = candleBucketAt(
    providerTimestamp,
    input.intervalSeconds,
  );
  if (providerClock.easternDate !== input.displayedSessionDate) {
    return {
      sessionScope: input.sessionScope,
      displayedSessionDate: input.displayedSessionDate,
      providerTimestamp,
      providerSession: providerClock.session,
      candleIntervalTimestamp,
      displayPriceAppliedToCandle: false,
      reason: "outside_displayed_session",
    };
  }
  if (!stockSessionAllowedInChartScope(providerClock.session, input.sessionScope)) {
    return {
      sessionScope: input.sessionScope,
      displayedSessionDate: input.displayedSessionDate,
      providerTimestamp,
      providerSession: providerClock.session,
      candleIntervalTimestamp,
      displayPriceAppliedToCandle: false,
      reason: "outside_session_scope",
    };
  }
  return {
    sessionScope: input.sessionScope,
    displayedSessionDate: input.displayedSessionDate,
    providerTimestamp,
    providerSession: providerClock.session,
    candleIntervalTimestamp,
    displayPriceAppliedToCandle: true,
    reason: "aligned",
  };
}

export function mergeMarketChartFeedDelta(
  current: MarketChartFeedFrame,
  delta: MarketChartDeltaResponse,
  receivedAt = Date.now(),
): MarketChartFeedFrame {
  if (
    !validMarketChartDeltaResponse(delta, {
      asset: "stock",
      symbol: current.chart.symbol,
      sessionScope: current.sessionAuthority.sessionScope,
      displayedSessionDate: current.sessionAuthority.displayedSessionDate,
    }) ||
    current.chart.asset !== "stock" ||
    delta.asset !== "stock" ||
    current.chart.symbol !== delta.symbol ||
    delta.feedVersion !== MARKET_CHART_FEED_VERSION ||
    delta.sessionAuthority.sessionScope !== current.sessionAuthority.sessionScope ||
    delta.sessionAuthority.displayedSessionDate !==
      current.sessionAuthority.displayedSessionDate ||
    !authorityMatchesProviderQuote(
      delta.sessionAuthority,
      delta.displayQuote,
    ) ||
    (delta.instrumentation !== undefined &&
      !validInstrumentation(delta.instrumentation, "delta"))
  ) {
    return current;
  }

  const deltaRequests =
    current.instrumentation.deltaProviderRequests +
    (delta.instrumentation?.providerRequestCount ?? 0);
  const acceptedEvidenceCount =
    current.instrumentation.acceptedEvidenceCount +
    (delta.instrumentation?.acceptedEvidenceCount ?? 0);
  const reusedEvidenceCount =
    current.instrumentation.reusedEvidenceCount +
    (delta.instrumentation?.reusedEvidenceCount ?? 0);
  const measuredFrame: MarketChartFeedFrame = {
    ...current,
    instrumentation: {
      ...current.instrumentation,
      deltaProviderRequests: deltaRequests,
      totalProviderRequests:
        current.instrumentation.bootstrapProviderRequests + deltaRequests,
      acceptedEvidenceCount,
      reusedEvidenceCount,
      comparablePollingFrames:
        current.instrumentation.comparablePollingFrames +
        (delta.instrumentation ? 1 : 0),
      legacyEquivalentRequests:
        current.instrumentation.legacyEquivalentRequests +
        (delta.instrumentation?.legacyEquivalentRequestCount ?? 0),
    },
  };

  const previousAsOf = current.chart.displayQuote?.asOf
    ? Date.parse(current.chart.displayQuote.asOf)
    : Number.NEGATIVE_INFINITY;
  const nextAsOf = Date.parse(delta.displayQuote.asOf);
  // A provider timestamp is the immutable frame boundary. Replaying an equal
  // timestamp must not allow a duplicate payload to rewrite price or OHLC.
  if (!Number.isFinite(nextAsOf) || nextAsOf < previousAsOf) {
    return measuredFrame;
  }
  if (nextAsOf === previousAsOf) {
    if (
      current.chart.displayQuote?.live === true &&
      delta.displayQuote.live === false &&
      current.chart.displayQuote.price === delta.displayQuote.price
    ) {
      return {
        ...measuredFrame,
        chart: {
          ...current.chart,
          displayQuote: {
            ...current.chart.displayQuote,
            live: false,
          },
        },
        // Equal provider time is the same immutable market frame. It may
        // downgrade Live, but it can never renew the receipt age.
        receivedAt: current.receivedAt,
      };
    }
    return measuredFrame;
  }

  const sessionDate = delta.sessionAuthority.displayedSessionDate;
  const scopedBars = delta.bars.filter((bar) => {
    const clock = getStockMarketClock(new Date(bar.time * 1_000));
    return (
      clock.easternDate === sessionDate &&
      stockSessionAllowedInChartScope(
        clock.session,
        delta.sessionAuthority.sessionScope,
      )
    );
  });
  let bars = mergeMarketBars(current.chart.bars, scopedBars);
  if (delta.sessionAuthority.displayPriceAppliedToCandle) {
    const merged = mergeSharedDisplayPriceIntoCurrentCandle({
      bars,
      timeframe: "1m",
      displayedSession: delta.sessionAuthority.sessionScope,
      update: {
        price: delta.displayQuote.price,
        providerTimestamp: delta.displayQuote.asOf,
        ...(delta.sessionAuthority.providerSession &&
        delta.sessionAuthority.providerSession !== "closed"
          ? { providerSession: delta.sessionAuthority.providerSession }
          : {}),
      },
    });
    if (
      !merged.applied ||
      merged.reason !== "applied" ||
      merged.candleIntervalTimestamp !==
        Date.parse(delta.sessionAuthority.candleIntervalTimestamp ?? "") / 1_000
    ) {
      return measuredFrame;
    }
    bars = merged.bars;
  }
  const summary = summarizeMarketBars(bars);
  const latest = bars.at(-1);
  if (!summary || !latest) return measuredFrame;

  const nextFrame: MarketChartFeedFrame = {
    chart: {
      ...current.chart,
      bars,
      summary,
      latestAt: new Date(latest.time * 1_000).toISOString(),
      displayQuote: {
        ...delta.displayQuote,
        changePercent: (() => {
          const previousClose = Number(current.previousClose);
          return previousClose > 0
            ? ((delta.displayQuote.price - previousClose) / previousClose) * 100
            : delta.displayQuote.changePercent;
        })(),
      },
    },
    previousClose: current.previousClose,
    receivedAt,
    sessionAuthority: delta.sessionAuthority,
    instrumentation: measuredFrame.instrumentation,
  };
  return marketChartFrameHasSharedPriceInvariant({
    bars: nextFrame.chart.bars,
    displayQuote: nextFrame.chart.displayQuote,
    sessionAuthority: nextFrame.sessionAuthority,
  })
    ? nextFrame
    : measuredFrame;
}

export function marketChartFeedFrameFromBootstrap(
  bootstrap: MarketChartBootstrapResponse,
  receivedAt = Date.now(),
): MarketChartFeedFrame {
  return {
    chart: bootstrap,
    previousClose: bootstrap.previousClose,
    receivedAt,
    sessionAuthority: bootstrap.sessionAuthority,
    instrumentation: {
      bootstrapProviderRequests: bootstrap.instrumentation.providerRequestCount,
      deltaProviderRequests: 0,
      totalProviderRequests: bootstrap.instrumentation.providerRequestCount,
      acceptedEvidenceCount: bootstrap.instrumentation.acceptedEvidenceCount,
      reusedEvidenceCount: bootstrap.instrumentation.reusedEvidenceCount,
      comparablePollingFrames: 1,
      legacyEquivalentRequests:
        bootstrap.instrumentation.legacyEquivalentRequestCount,
    },
  };
}

export function summarizeMarketChartFeedEfficiency(
  frame: MarketChartFeedFrame,
) {
  const legacy = frame.instrumentation.legacyEquivalentRequests;
  const observed = frame.instrumentation.totalProviderRequests;
  const saved = Math.max(0, legacy - observed);
  return {
    observedProviderRequests: observed,
    acceptedEvidenceCount: frame.instrumentation.acceptedEvidenceCount,
    reusedEvidenceCount: frame.instrumentation.reusedEvidenceCount,
    comparablePollingFrames: frame.instrumentation.comparablePollingFrames,
    modeledLegacyRequests: legacy,
    modeledSavedRequests: saved,
    reductionPercent: legacy > 0
      ? Number(((saved / legacy) * 100).toFixed(1))
      : 0,
  };
}
