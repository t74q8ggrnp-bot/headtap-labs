import type { PolygonSnapshotRow } from "@/lib/polygon-snapshot";

export const MASSIVE_STOCKS_ORIGIN = "https://api.polygon.io";
export const MASSIVE_STOCKS_PROVIDER = "massive_polygon";
export const MASSIVE_REALTIME_PROBE_SYMBOL = "AAPL";

export type MassiveStocksDataMode =
  | "real_time"
  | "delayed"
  | "unavailable";

type MassivePayload = {
  status?: unknown;
  error?: unknown;
  message?: unknown;
  results?: unknown;
  ticker?: PolygonSnapshotRow;
};

type MassiveTradeResult = {
  conditions?: unknown;
  exchange?: unknown;
  id?: unknown;
  p?: unknown;
  price?: unknown;
  s?: unknown;
  size?: unknown;
  t?: unknown;
  sip_timestamp?: unknown;
};

type MassiveQuoteResult = {
  p?: unknown;
  P?: unknown;
  s?: unknown;
  S?: unknown;
  t?: unknown;
  sip_timestamp?: unknown;
};

export type MassiveRealtimeEntitlement = {
  configured: boolean;
  dataMode: MassiveStocksDataMode;
  snapshot: boolean;
  lastTrade: boolean;
  lastQuote: boolean;
  checkedAt: string;
  errors: string[];
  /** Provider throttle metadata, when any entitlement probe was throttled. */
  rateLimitStatus: number | null;
  retryAfter: string | null;
};

export type MassiveLastTrade = {
  price: number;
  size: number | null;
  timestamp: string;
};

export type MassiveLastQuote = {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  timestamp: string;
};

export function massiveLastQuoteHasUsableNbbo(
  quote: MassiveLastQuote | null | undefined,
) {
  return Boolean(
    quote &&
      quote.bid !== null &&
      quote.ask !== null &&
      quote.bid > 0 &&
      quote.ask >= quote.bid &&
      Number.isFinite(Date.parse(quote.timestamp)),
  );
}

export type MassiveTradePrint = {
  id: string | null;
  price: number;
  size: number;
  exchange: number | null;
  conditions: number[];
  timestamp: string;
};

export type MassiveProviderResult<T> = {
  value: T;
  error: string | null;
};

export type MassiveProviderHttpResult<T> = MassiveProviderResult<T> & {
  status: number;
  retryAfter: string | null;
};

export type MassiveRecentTrades = {
  trades: MassiveTradePrint[];
  truncated: boolean;
};

let cachedEntitlement:
  | { expiresAt: number; value: MassiveRealtimeEntitlement }
  | null = null;

const positiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function massiveTimestampMs(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed >= 1e17) return parsed / 1e6;
  if (parsed >= 1e14) return parsed / 1e3;
  return parsed;
}

function providerError(payload: MassivePayload, status: number) {
  const detail = payload.error ?? payload.message;
  return typeof detail === "string" && detail.trim()
    ? detail
    : `Massive returned ${status}.`;
}

function apiKey() {
  return process.env.POLYGON_API_KEY?.trim() ?? "";
}

export function massiveStocksUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  const url = new URL(path, MASSIVE_STOCKS_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const key = apiKey();
  if (key) url.searchParams.set("apiKey", key);
  return url;
}

async function massiveJson(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  if (!apiKey()) {
    return {
      ok: false,
      status: 0,
      retryAfter: null,
      payload: {} as MassivePayload,
      error: "Missing POLYGON_API_KEY.",
    };
  }
  try {
    const response = await fetch(massiveStocksUrl(path, params), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    let payload: MassivePayload = {};
    try {
      payload = (await response.json()) as MassivePayload;
    } catch {
      // Preserve the HTTP failure below when a provider edge returns no JSON.
    }
    return {
      ok: response.ok,
      status: response.status,
      retryAfter: response.headers.get("Retry-After"),
      payload,
      error: response.ok ? null : providerError(payload, response.status),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      retryAfter: null,
      payload: {} as MassivePayload,
      error: error instanceof Error ? error.message : "Massive request failed.",
    };
  }
}

function payloadResult<T>(payload: MassivePayload): T | null {
  return payload.results && typeof payload.results === "object"
    ? (payload.results as T)
    : null;
}

export async function fetchMassiveLastTrade(
  symbol: string,
): Promise<MassiveLastTrade | null> {
  return (await fetchMassiveLastTradeResult(symbol)).value;
}

export async function fetchMassiveLastTradeResult(
  symbol: string,
): Promise<MassiveProviderHttpResult<MassiveLastTrade | null>> {
  const result = await massiveJson(
    `/v2/last/trade/${encodeURIComponent(symbol)}`,
  );
  if (!result.ok) {
    return {
      value: null,
      error: result.error,
      status: result.status,
      retryAfter: result.retryAfter,
    };
  }
  const trade = payloadResult<MassiveTradeResult>(result.payload);
  const price = positiveNumber(trade?.p);
  const timestampMs = massiveTimestampMs(trade?.sip_timestamp ?? trade?.t);
  if (price === null || timestampMs === null) {
    return {
      value: null,
      error: "Massive trade had no verified price or provider timestamp.",
      status: result.status,
      retryAfter: result.retryAfter,
    };
  }
  const size = positiveNumber(trade?.s);
  return {
    value: {
      price,
      size,
      timestamp: new Date(timestampMs).toISOString(),
    },
    error: null,
    status: result.status,
    retryAfter: result.retryAfter,
  };
}

export async function fetchMassiveLastQuote(
  symbol: string,
): Promise<MassiveLastQuote | null> {
  const result = await fetchMassiveLastQuoteResult(symbol);
  return result.value;
}

export async function fetchMassiveLastQuoteResult(
  symbol: string,
): Promise<MassiveProviderHttpResult<MassiveLastQuote | null>> {
  const result = await massiveJson(
    `/v2/last/nbbo/${encodeURIComponent(symbol)}`,
  );
  if (!result.ok) {
    return {
      value: null,
      error: result.error,
      status: result.status,
      retryAfter: result.retryAfter,
    };
  }
  const quote = payloadResult<MassiveQuoteResult>(result.payload);
  const timestampMs = massiveTimestampMs(quote?.sip_timestamp ?? quote?.t);
  if (timestampMs === null) {
    return {
      value: null,
      error: "Massive quote had no provider timestamp.",
      status: result.status,
      retryAfter: result.retryAfter,
    };
  }
  const value: MassiveLastQuote = {
      bid: positiveNumber(quote?.p),
      ask: positiveNumber(quote?.P),
      bidSize: positiveNumber(quote?.s),
      askSize: positiveNumber(quote?.S),
      timestamp: new Date(timestampMs).toISOString(),
  };
  if (!massiveLastQuoteHasUsableNbbo(value)) {
    return {
      value: null,
      error: "Massive quote had no usable, non-crossed NBBO bid and ask.",
      status: result.status,
      retryAfter: result.retryAfter,
    };
  }
  return {
    value,
    error: null,
    status: result.status,
    retryAfter: result.retryAfter,
  };
}

export async function fetchMassiveHistoricalQuoteAtOrAfter(
  symbol: string,
  target: string | Date,
  toleranceMs = 60_000,
): Promise<MassiveLastQuote | null> {
  const targetMs = (target instanceof Date ? target : new Date(target)).getTime();
  if (!Number.isFinite(targetMs) || toleranceMs <= 0) return null;
  const result = await massiveJson(
    `/v3/quotes/${encodeURIComponent(symbol)}`,
    {
      "timestamp.gte": (BigInt(Math.floor(targetMs)) * BigInt(1_000_000)).toString(),
      "timestamp.lte": (BigInt(Math.floor(targetMs + toleranceMs)) * BigInt(1_000_000)).toString(),
      sort: "timestamp",
      order: "asc",
      limit: 1,
    },
  );
  if (!result.ok || !Array.isArray(result.payload.results)) return null;
  const quote = result.payload.results[0] as MassiveQuoteResult | undefined;
  const timestampMs = massiveTimestampMs(quote?.sip_timestamp ?? quote?.t);
  if (timestampMs === null) return null;
  return {
    bid: positiveNumber(quote?.p),
    ask: positiveNumber(quote?.P),
    bidSize: positiveNumber(quote?.s),
    askSize: positiveNumber(quote?.S),
    timestamp: new Date(timestampMs).toISOString(),
  };
}

export async function fetchMassiveRecentTrades(
  symbol: string,
  options: { since: Date; limit?: number },
): Promise<MassiveProviderResult<MassiveRecentTrades>> {
  const limit = Math.max(1, Math.min(50_000, Math.floor(options.limit ?? 1_000)));
  const sinceNanoseconds =
    BigInt(Math.max(0, options.since.getTime())) * BigInt(1_000_000);
  const result = await massiveJson(
    `/v3/trades/${encodeURIComponent(symbol)}`,
    {
      "timestamp.gte": sinceNanoseconds.toString(),
      sort: "timestamp",
      order: "desc",
      limit,
    },
  );
  if (!result.ok) {
    return {
      value: { trades: [], truncated: false },
      error: result.error,
    };
  }
  const rows = Array.isArray(result.payload.results)
    ? (result.payload.results as MassiveTradeResult[])
    : [];
  const trades = rows.flatMap((row): MassiveTradePrint[] => {
    const price = positiveNumber(row.price ?? row.p);
    const size = positiveNumber(row.size ?? row.s);
    const timestampMs = massiveTimestampMs(row.sip_timestamp ?? row.t);
    if (price === null || size === null || timestampMs === null) return [];
    const conditions = Array.isArray(row.conditions)
      ? row.conditions
          .map(Number)
          .filter((condition) => Number.isInteger(condition) && condition >= 0)
      : [];
    const exchange = Number(row.exchange);
    return [{
      id: typeof row.id === "string" ? row.id : null,
      price,
      size,
      exchange: Number.isInteger(exchange) && exchange > 0 ? exchange : null,
      conditions,
      timestamp: new Date(timestampMs).toISOString(),
    }];
  });
  return {
    value: { trades, truncated: rows.length >= limit },
    error: null,
  };
}

export async function fetchMassiveStockSnapshot(
  symbol: string,
): Promise<PolygonSnapshotRow | null> {
  return (await fetchMassiveStockSnapshotResult(symbol)).value;
}

export async function fetchMassiveStockSnapshotResult(
  symbol: string,
): Promise<MassiveProviderHttpResult<PolygonSnapshotRow | null>> {
  const result = await massiveJson(
    `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`,
  );
  return {
    value: result.ok && result.payload.ticker ? result.payload.ticker : null,
    error: result.ok && result.payload.ticker
      ? null
      : result.error ?? "Massive snapshot had no ticker payload.",
    status: result.status,
    retryAfter: result.retryAfter,
  };
}

export async function probeMassiveRealtimeEntitlement(options: {
  force?: boolean;
  symbol?: string;
} = {}): Promise<MassiveRealtimeEntitlement> {
  const now = Date.now();
  if (!options.force && cachedEntitlement?.expiresAt && cachedEntitlement.expiresAt > now) {
    return cachedEntitlement.value;
  }
  const configured = Boolean(apiKey());
  if (!configured) {
    return {
      configured: false,
      dataMode: "unavailable",
      snapshot: false,
      lastTrade: false,
      lastQuote: false,
      checkedAt: new Date(now).toISOString(),
      errors: ["Missing POLYGON_API_KEY."],
      rateLimitStatus: null,
      retryAfter: null,
    };
  }

  const symbol = (options.symbol ?? MASSIVE_REALTIME_PROBE_SYMBOL).toUpperCase();
  const [snapshotResult, tradeResult, quoteResult] = await Promise.all([
    massiveJson(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`,
    ),
    massiveJson(`/v2/last/trade/${encodeURIComponent(symbol)}`),
    massiveJson(`/v2/last/nbbo/${encodeURIComponent(symbol)}`),
  ]);
  const snapshot = snapshotResult.ok && Boolean(snapshotResult.payload.ticker);
  const lastTrade = tradeResult.ok && Boolean(tradeResult.payload.results);
  const lastQuote = quoteResult.ok && Boolean(quoteResult.payload.results);
  const errors = [snapshotResult, tradeResult, quoteResult]
    .flatMap((result) => result.error ? [result.error] : []);
  const throttled = [snapshotResult, tradeResult, quoteResult].find(
    (result) =>
      result.status === 429 ||
      result.status === 503 ||
      Boolean(result.retryAfter?.trim()),
  );
  const value: MassiveRealtimeEntitlement = {
    configured,
    dataMode: snapshot && lastTrade && lastQuote ? "real_time" : snapshot ? "delayed" : "unavailable",
    snapshot,
    lastTrade,
    lastQuote,
    checkedAt: new Date().toISOString(),
    errors,
    rateLimitStatus: throttled?.status ?? null,
    retryAfter: throttled?.retryAfter ?? null,
  };
  // A transient provider error must not poison serving routes for five
  // minutes. Cache only complete entitlement proof for the long window; a
  // partial result receives a short Retry-After-bounded cooldown.
  const parsedRetryAfterMs = (() => {
    const raw = value.retryAfter?.trim();
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - now) : 0;
  })();
  const ttlMs = value.dataMode === "real_time"
    ? 5 * 60 * 1_000
    : Math.min(30_000, Math.max(2_000, parsedRetryAfterMs));
  cachedEntitlement = { expiresAt: now + ttlMs, value };
  return value;
}
