export const INSTRUMENT_SEARCH_SOURCE = "massive_reference_tickers" as const;
export const INSTRUMENT_METADATA_TTL_MS = 6 * 60 * 60 * 1_000;
export const INSTRUMENT_SEARCH_MAX_RESULTS = 10;

const MASSIVE_STOCKS_ORIGIN = "https://api.polygon.io";
const MASSIVE_STOCKS_PROVIDER = "massive_polygon" as const;
const PROVIDER_RESULT_LIMIT = 50;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const SEARCH_CACHE_LIMIT = 500;
const DETAIL_CACHE_LIMIT = 1_000;

type MassiveReferenceTicker = {
  ticker?: unknown;
  name?: unknown;
  market?: unknown;
  locale?: unknown;
  primary_exchange?: unknown;
  type?: unknown;
  active?: unknown;
  currency_name?: unknown;
  cik?: unknown;
  composite_figi?: unknown;
  share_class_figi?: unknown;
  last_updated_utc?: unknown;
};

type MassiveReferencePayload = {
  results?: unknown;
  error?: unknown;
  message?: unknown;
};

export type InstrumentAssetKind = "stock" | "etf" | "other";

export type WorkspaceInstrument = {
  symbol: string;
  name: string;
  market: string | null;
  locale: string | null;
  primaryExchange: string | null;
  securityType: string | null;
  assetKind: InstrumentAssetKind;
  active: boolean;
  currency: string | null;
  cik: string | null;
  compositeFigi: string | null;
  shareClassFigi: string | null;
  providerUpdatedAt: string | null;
  workspaceSupported: boolean;
  provider: typeof MASSIVE_STOCKS_PROVIDER;
};

export type InstrumentMetadataCacheState =
  | "instance_hit"
  | "instance_miss"
  | "shared_inflight";

export type InstrumentSearchResponse = {
  query: string;
  results: WorkspaceInstrument[];
  source: typeof INSTRUMENT_SEARCH_SOURCE;
  provider: typeof MASSIVE_STOCKS_PROVIDER;
  loadedAt: string;
  cacheState: InstrumentMetadataCacheState;
};

export type InstrumentDetailResponse = {
  instrument: WorkspaceInstrument;
  source: typeof INSTRUMENT_SEARCH_SOURCE;
  provider: typeof MASSIVE_STOCKS_PROVIDER;
  loadedAt: string;
  cacheState: InstrumentMetadataCacheState;
};

export type InstrumentSearchErrorCode =
  | "missing_configuration"
  | "provider_unavailable"
  | "invalid_provider_response"
  | "not_found";

export class InstrumentSearchError extends Error {
  readonly code: InstrumentSearchErrorCode;
  readonly providerStatus: number | null;

  constructor(
    code: InstrumentSearchErrorCode,
    message: string,
    providerStatus: number | null = null,
  ) {
    super(message);
    this.name = "InstrumentSearchError";
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

type CacheEntry<T> = {
  expiresAt: number;
  loadedAt: string;
  value: T;
};

type InstrumentSearchGlobalState = typeof globalThis & {
  __htInstrumentSearchCache?: Map<string, CacheEntry<WorkspaceInstrument[]>>;
  __htInstrumentDetailCache?: Map<string, CacheEntry<WorkspaceInstrument>>;
  __htInstrumentSearchInflight?: Map<string, Promise<CacheEntry<WorkspaceInstrument[]>>>;
  __htInstrumentDetailInflight?: Map<string, Promise<CacheEntry<WorkspaceInstrument>>>;
};

const sharedState = globalThis as InstrumentSearchGlobalState;
const searchCache: Map<string, CacheEntry<WorkspaceInstrument[]>> =
  sharedState.__htInstrumentSearchCache ?? new Map();
const detailCache: Map<string, CacheEntry<WorkspaceInstrument>> =
  sharedState.__htInstrumentDetailCache ?? new Map();
const searchInflight: Map<string, Promise<CacheEntry<WorkspaceInstrument[]>>> =
  sharedState.__htInstrumentSearchInflight ?? new Map();
const detailInflight: Map<string, Promise<CacheEntry<WorkspaceInstrument>>> =
  sharedState.__htInstrumentDetailInflight ?? new Map();
sharedState.__htInstrumentSearchCache = searchCache;
sharedState.__htInstrumentDetailCache = detailCache;
sharedState.__htInstrumentSearchInflight = searchInflight;
sharedState.__htInstrumentDetailInflight = detailInflight;

type ProviderOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: number;
  ttlMs?: number;
};

type SearchOptions = ProviderOptions & {
  limit?: number;
};

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeInstrumentSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function normalizeInstrumentSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/^\$/, "").replace(/\s+/g, " ");
  if (
    query.length < 1 ||
    query.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(query) ||
    !/[a-z0-9]/i.test(query)
  ) {
    return null;
  }
  return query;
}

function classifyInstrumentType(securityType: string | null): InstrumentAssetKind {
  if (["ETF", "ETN", "ETV", "FUND"].includes(securityType ?? "")) return "etf";
  if (["CS", "ADRC"].includes(securityType ?? "")) return "stock";
  return "other";
}

function mapProviderInstrument(row: MassiveReferenceTicker): WorkspaceInstrument | null {
  const symbol = normalizeInstrumentSymbol(row.ticker);
  const name = textOrNull(row.name);
  if (!symbol || !name) return null;

  const market = textOrNull(row.market)?.toLowerCase() ?? null;
  const locale = textOrNull(row.locale)?.toLowerCase() ?? null;
  const securityType = textOrNull(row.type)?.toUpperCase() ?? null;
  // Missing provider state must never be promoted to active. Search requests
  // explicitly ask Massive for active listings, but the response still owns
  // that fact and must state it affirmatively.
  const active = row.active === true;
  const assetKind = classifyInstrumentType(securityType);

  return {
    symbol,
    name,
    market,
    locale,
    primaryExchange: textOrNull(row.primary_exchange)?.toUpperCase() ?? null,
    securityType,
    assetKind,
    active,
    currency: textOrNull(row.currency_name)?.toLowerCase() ?? null,
    cik: textOrNull(row.cik),
    compositeFigi: textOrNull(row.composite_figi),
    shareClassFigi: textOrNull(row.share_class_figi),
    providerUpdatedAt: textOrNull(row.last_updated_utc),
    // Workspace support is intentionally independent from Canonical security-
    // type eligibility. ETFs such as SPY and QQQ remain viewable here without
    // entering the small-cap detection/ranking pipeline.
    workspaceSupported:
      active &&
      market === "stocks" &&
      locale === "us" &&
      (assetKind === "stock" || assetKind === "etf"),
    provider: MASSIVE_STOCKS_PROVIDER,
  };
}

function resultRank(query: string, instrument: WorkspaceInstrument) {
  const needle = query.toUpperCase();
  const symbol = instrument.symbol.toUpperCase();
  const name = instrument.name.toUpperCase();
  if (symbol === needle) return 0;
  if (symbol.startsWith(needle)) return 1;
  if (name === needle) return 2;
  if (name.startsWith(needle)) return 3;
  if (symbol.includes(needle)) return 4;
  if (name.includes(needle)) return 5;
  return 6;
}

export function rankInstrumentResults(
  query: string,
  rows: WorkspaceInstrument[],
  limit = INSTRUMENT_SEARCH_MAX_RESULTS,
) {
  const unique = new Map<string, WorkspaceInstrument>();
  for (const row of rows) {
    if (!row.workspaceSupported || unique.has(row.symbol)) continue;
    unique.set(row.symbol, row);
  }

  return [...unique.values()]
    .sort((left, right) => {
      const rankDifference = resultRank(query, left) - resultRank(query, right);
      if (rankDifference !== 0) return rankDifference;
      const lengthDifference = left.symbol.length - right.symbol.length;
      return lengthDifference || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, Math.max(1, Math.min(INSTRUMENT_SEARCH_MAX_RESULTS, Math.floor(limit))));
}

function apiKey(options: ProviderOptions) {
  return options.apiKey?.trim() || process.env.POLYGON_API_KEY?.trim() || "";
}

function providerUrl(
  path: string,
  key: string,
  params: Record<string, string | number | boolean> = {},
) {
  const url = new URL(path, MASSIVE_STOCKS_ORIGIN);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }
  url.searchParams.set("apiKey", key);
  return url;
}

async function fetchProviderPayload(
  path: string,
  params: Record<string, string | number | boolean>,
  options: ProviderOptions,
) {
  const key = apiKey(options);
  if (!key) {
    throw new InstrumentSearchError(
      "missing_configuration",
      "Massive stock reference metadata is not configured.",
    );
  }

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(providerUrl(path, key, params), {
      cache: "force-cache",
      next: { revalidate: Math.floor(INSTRUMENT_METADATA_TTL_MS / 1_000) },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new InstrumentSearchError(
      "provider_unavailable",
      "Massive reference metadata is temporarily unavailable.",
    );
  }

  if (!response.ok) {
    throw new InstrumentSearchError(
      response.status === 404 ? "not_found" : "provider_unavailable",
      response.status === 404
        ? "Instrument was not found in Massive reference metadata."
        : "Massive reference metadata is temporarily unavailable.",
      response.status,
    );
  }

  try {
    return (await response.json()) as MassiveReferencePayload;
  } catch {
    throw new InstrumentSearchError(
      "invalid_provider_response",
      "Massive reference metadata returned an invalid response.",
      response.status,
    );
  }
}

function putBounded<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  entry: CacheEntry<T>,
  maxSize: number,
  now: number,
) {
  for (const [cachedKey, cached] of cache) {
    if (cached.expiresAt <= now) cache.delete(cachedKey);
  }
  while (cache.size >= maxSize) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  cache.set(key, entry);
}

function validCached<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return cached;
}

function seedExactInstrumentDetail(
  query: string,
  entry: CacheEntry<WorkspaceInstrument[]>,
  now: number,
) {
  const exactSymbol = normalizeInstrumentSymbol(query);
  if (!exactSymbol || validCached(detailCache, exactSymbol, now)) return;
  const exact = entry.value.find(
    (instrument) =>
      instrument.symbol === exactSymbol &&
      instrument.workspaceSupported &&
      instrument.active &&
      instrument.provider === MASSIVE_STOCKS_PROVIDER,
  );
  if (!exact) return;
  putBounded(
    detailCache,
    exactSymbol,
    {
      expiresAt: entry.expiresAt,
      loadedAt: entry.loadedAt,
      value: exact,
    },
    DETAIL_CACHE_LIMIT,
    now,
  );
}

export async function searchMassiveInstruments(
  rawQuery: string,
  options: SearchOptions = {},
): Promise<InstrumentSearchResponse> {
  const query = normalizeInstrumentSearchQuery(rawQuery);
  if (!query) {
    throw new TypeError("Instrument search query must contain 1–64 valid characters.");
  }
  const now = options.now ?? Date.now();
  const cacheKey = query.toUpperCase();
  const limit = Math.max(
    1,
    Math.min(INSTRUMENT_SEARCH_MAX_RESULTS, Math.floor(options.limit ?? 8)),
  );
  const cached = validCached(searchCache, cacheKey, now);
  if (cached) {
    seedExactInstrumentDetail(query, cached, now);
    return {
      query,
      results: cached.value.slice(0, limit),
      source: INSTRUMENT_SEARCH_SOURCE,
      provider: MASSIVE_STOCKS_PROVIDER,
      loadedAt: cached.loadedAt,
      cacheState: "instance_hit",
    };
  }

  const existing = searchInflight.get(cacheKey);
  const cacheState: InstrumentMetadataCacheState = existing
    ? "shared_inflight"
    : "instance_miss";
  const promise = existing ?? (async () => {
    const payload = await fetchProviderPayload(
      "/v3/reference/tickers",
      {
        market: "stocks",
        locale: "us",
        active: true,
        search: query,
        sort: "ticker",
        order: "asc",
        limit: PROVIDER_RESULT_LIMIT,
      },
      options,
    );
    if (!Array.isArray(payload.results)) {
      throw new InstrumentSearchError(
        "invalid_provider_response",
        "Massive reference metadata returned no searchable results collection.",
      );
    }
    const results = rankInstrumentResults(
      query,
      payload.results.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const mapped = mapProviderInstrument(row as MassiveReferenceTicker);
        return mapped ? [mapped] : [];
      }),
      INSTRUMENT_SEARCH_MAX_RESULTS,
    );
    const loadedAt = new Date(now).toISOString();
    const entry = {
      expiresAt: now + Math.max(60_000, options.ttlMs ?? INSTRUMENT_METADATA_TTL_MS),
      loadedAt,
      value: results,
    };
    putBounded(searchCache, cacheKey, entry, SEARCH_CACHE_LIMIT, now);
    return entry;
  })();

  if (!existing) searchInflight.set(cacheKey, promise);
  try {
    const entry = await promise;
    seedExactInstrumentDetail(query, entry, now);
    return {
      query,
      results: entry.value.slice(0, limit),
      source: INSTRUMENT_SEARCH_SOURCE,
      provider: MASSIVE_STOCKS_PROVIDER,
      loadedAt: entry.loadedAt,
      cacheState,
    };
  } finally {
    if (!existing && searchInflight.get(cacheKey) === promise) {
      searchInflight.delete(cacheKey);
    }
  }
}

export async function fetchMassiveInstrument(
  rawSymbol: string,
  options: ProviderOptions = {},
): Promise<InstrumentDetailResponse> {
  const symbol = normalizeInstrumentSymbol(rawSymbol);
  if (!symbol) throw new TypeError("A valid stock or ETF symbol is required.");
  const now = options.now ?? Date.now();
  const cached = validCached(detailCache, symbol, now);
  if (cached) {
    return {
      instrument: cached.value,
      source: INSTRUMENT_SEARCH_SOURCE,
      provider: MASSIVE_STOCKS_PROVIDER,
      loadedAt: cached.loadedAt,
      cacheState: "instance_hit",
    };
  }

  const existing = detailInflight.get(symbol);
  const cacheState: InstrumentMetadataCacheState = existing
    ? "shared_inflight"
    : "instance_miss";
  const promise = existing ?? (async () => {
    const payload = await fetchProviderPayload(
      `/v3/reference/tickers/${encodeURIComponent(symbol)}`,
      {},
      options,
    );
    if (!payload.results || typeof payload.results !== "object" || Array.isArray(payload.results)) {
      throw new InstrumentSearchError(
        "not_found",
        "Instrument was not found in Massive reference metadata.",
        404,
      );
    }
    const instrument = mapProviderInstrument(payload.results as MassiveReferenceTicker);
    if (!instrument || instrument.symbol !== symbol) {
      throw new InstrumentSearchError(
        "invalid_provider_response",
        "Massive reference metadata returned an invalid instrument.",
      );
    }
    const loadedAt = new Date(now).toISOString();
    const entry = {
      expiresAt: now + Math.max(60_000, options.ttlMs ?? INSTRUMENT_METADATA_TTL_MS),
      loadedAt,
      value: instrument,
    };
    putBounded(detailCache, symbol, entry, DETAIL_CACHE_LIMIT, now);
    return entry;
  })();

  if (!existing) detailInflight.set(symbol, promise);
  try {
    const entry = await promise;
    return {
      instrument: entry.value,
      source: INSTRUMENT_SEARCH_SOURCE,
      provider: MASSIVE_STOCKS_PROVIDER,
      loadedAt: entry.loadedAt,
      cacheState,
    };
  } finally {
    if (!existing && detailInflight.get(symbol) === promise) {
      detailInflight.delete(symbol);
    }
  }
}

export function clearInstrumentSearchCachesForTests() {
  searchCache.clear();
  detailCache.clear();
  searchInflight.clear();
  detailInflight.clear();
}
