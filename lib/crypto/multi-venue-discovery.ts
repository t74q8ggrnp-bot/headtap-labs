import "server-only";

import type {
  CryptoDiscoveryPrice,
  CryptoDiscoveryVenue,
  CryptoDiscoveryWindow,
  CryptoOpportunity,
  CryptoShadowDiscovery,
} from "@/lib/crypto/contracts";

const KRAKEN_ORIGIN = "https://api.kraken.com";
const CRYPTO_COM_ORIGIN = "https://api.crypto.com/exchange/v1";
const COINGECKO_ORIGIN = "https://api.coingecko.com/api/v3";
const DISCOVERY_CANDIDATE_LIMIT = 25;
const STABLE_ASSETS = new Set([
  "DAI",
  "EURC",
  "GUSD",
  "PAX",
  "PYUSD",
  "USDC",
  "USDP",
  "USDS",
  "USDT",
]);
const USD_EQUIVALENT_QUOTES = new Set([
  "USD",
  "USDC",
  "USDT",
  "PYUSD",
]);
const SUPPORTED_QUOTES = new Set([
  ...USD_EQUIVALENT_QUOTES,
  "BTC",
  "ETH",
  "CRO",
]);

type RawVenueMarket = {
  venue: CryptoDiscoveryVenue;
  productId: string;
  symbol: string;
  quoteCurrency: string;
  sourceWindow: CryptoDiscoveryWindow;
  last: number;
  open: number;
  high: number;
  low: number;
  volumeBase: number;
  dollarVolumeUsd: number | null;
  bid: number | null;
  ask: number | null;
  tradeCount: number | null;
};

type NormalizedVenueMarket = {
  venue: CryptoDiscoveryVenue;
  productId: string;
  symbol: string;
  quoteCurrency: string;
  sourceWindow: CryptoDiscoveryWindow;
  priceUsd: number;
  openUsd: number;
  highUsd: number;
  lowUsd: number;
  observedMovePercent: number;
  dollarVolume: number;
  spreadPercent: number | null;
  tradeCount: number | null;
};

type VenueLoadResult = {
  venue: Exclude<CryptoDiscoveryVenue, "coinbase">;
  ok: boolean;
  markets: RawVenueMarket[];
  message: string;
};

type AttentionItem = {
  symbol: string;
  coinId: string;
  rank: number;
};

type AttentionLoadResult = {
  ok: boolean;
  items: AttentionItem[];
};

export type CryptoDiscoverySources = {
  venues: VenueLoadResult[];
  attention: AttentionLoadResult;
};

type KrakenAssetPair = {
  wsname?: unknown;
  altname?: unknown;
  base?: unknown;
  quote?: unknown;
  status?: unknown;
};

type KrakenTicker = {
  a?: unknown;
  b?: unknown;
  c?: unknown;
  v?: unknown;
  t?: unknown;
  l?: unknown;
  h?: unknown;
  o?: unknown;
};

type KrakenResponse<T> = {
  error?: unknown;
  result?: T;
};

type CryptoComInstrument = {
  symbol?: unknown;
  inst_type?: unknown;
  base_ccy?: unknown;
  quote_ccy?: unknown;
  tradable?: unknown;
  product_type?: unknown;
};

type CryptoComTicker = {
  i?: unknown;
  h?: unknown;
  l?: unknown;
  a?: unknown;
  v?: unknown;
  vv?: unknown;
  c?: unknown;
  b?: unknown;
  k?: unknown;
};

type CryptoComResponse<T> = {
  code?: unknown;
  result?: {
    data?: T;
  };
};

const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const finiteNullable = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

const round = (value: number, precision = 3) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const canonicalSymbol = (value: unknown) => {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (symbol === "XBT") return "BTC";
  if (symbol === "XDG") return "DOGE";
  return symbol;
};

function arrayValue(value: unknown, index: number) {
  return Array.isArray(value) ? finite(value[index]) : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / values.length;
  return Math.sqrt(variance);
}

function liquidityScore(dollarVolume: number) {
  if (dollarVolume <= 0) return 0;
  return clamp((Math.log10(dollarVolume) - 4) * 25);
}

function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Provider request failed.";
  return error.message.slice(0, 180);
}

async function fetchPublicJson<T>(url: string, revalidate: number): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "HT-Labs-Crypto-Research/1.0",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function parseKrakenPairIdentity(key: string, pair: KrakenAssetPair) {
  const wsname = String(pair.wsname ?? "");
  const [wsBase, wsQuote] = wsname.split("/");
  const altname = String(pair.altname ?? "");
  const symbol = canonicalSymbol(wsBase || pair.base);
  const quoteCurrency = canonicalSymbol(wsQuote || pair.quote);
  const tickerKeys = [...new Set([
    key,
    wsname,
    altname,
    `${symbol}/${quoteCurrency}`,
  ].filter(Boolean))];
  return { symbol, quoteCurrency, tickerKeys };
}

async function loadKrakenMarkets(): Promise<VenueLoadResult> {
  try {
    const [pairsPayload, tickersPayload] = await Promise.all([
      fetchPublicJson<KrakenResponse<Record<string, KrakenAssetPair>>>(
        `${KRAKEN_ORIGIN}/0/public/AssetPairs?assetVersion=1`,
        300,
      ),
      fetchPublicJson<KrakenResponse<Record<string, KrakenTicker>>>(
        `${KRAKEN_ORIGIN}/0/public/Ticker?assetVersion=1`,
        60,
      ),
    ]);
    const pairErrors = Array.isArray(pairsPayload.error)
      ? pairsPayload.error.map(String).filter(Boolean)
      : [];
    const tickerErrors = Array.isArray(tickersPayload.error)
      ? tickersPayload.error.map(String).filter(Boolean)
      : [];
    if (pairErrors.length > 0 || tickerErrors.length > 0) {
      throw new Error([...pairErrors, ...tickerErrors].join("; "));
    }
    const pairs = pairsPayload.result ?? {};
    const tickers = tickersPayload.result ?? {};
    const markets = Object.entries(pairs).flatMap(([key, pair]) => {
      const { symbol, quoteCurrency, tickerKeys } = parseKrakenPairIdentity(
        key,
        pair,
      );
      const ticker = tickerKeys.map((tickerKey) => tickers[tickerKey]).find(Boolean);
      if (
        pair.status !== "online" ||
        !ticker ||
        !symbol ||
        !SUPPORTED_QUOTES.has(quoteCurrency) ||
        STABLE_ASSETS.has(symbol)
      ) {
        return [];
      }
      const last = arrayValue(ticker.c, 0);
      const open = finite(ticker.o);
      const high = arrayValue(ticker.h, 0);
      const low = arrayValue(ticker.l, 0);
      const volumeBase = arrayValue(ticker.v, 0);
      if (last <= 0 || open <= 0 || high <= 0 || low <= 0 || volumeBase <= 0) {
        return [];
      }
      return [{
        venue: "kraken" as const,
        productId: String(pair.wsname ?? key),
        symbol,
        quoteCurrency,
        sourceWindow: "utc_session" as const,
        last,
        open,
        high,
        low,
        volumeBase,
        dollarVolumeUsd: null,
        bid: finiteNullable(Array.isArray(ticker.b) ? ticker.b[0] : null),
        ask: finiteNullable(Array.isArray(ticker.a) ? ticker.a[0] : null),
        tradeCount: finiteNullable(Array.isArray(ticker.t) ? ticker.t[0] : null),
      }];
    });
    return {
      venue: "kraken",
      ok: true,
      markets,
      message: "Kraken spot catalog and all-market ticker are readable.",
    };
  } catch (error: unknown) {
    return {
      venue: "kraken",
      ok: false,
      markets: [],
      message: safeErrorMessage(error),
    };
  }
}

async function loadCryptoComMarkets(): Promise<VenueLoadResult> {
  try {
    const [instrumentsPayload, tickersPayload] = await Promise.all([
      fetchPublicJson<CryptoComResponse<CryptoComInstrument[]>>(
        `${CRYPTO_COM_ORIGIN}/public/get-instruments`,
        300,
      ),
      fetchPublicJson<CryptoComResponse<CryptoComTicker[]>>(
        `${CRYPTO_COM_ORIGIN}/public/get-tickers`,
        60,
      ),
    ]);
    if (finite(instrumentsPayload.code) !== 0 || finite(tickersPayload.code) !== 0) {
      throw new Error("Crypto.com returned a non-zero response code.");
    }
    const instruments = instrumentsPayload.result?.data ?? [];
    const tickers = new Map(
      (tickersPayload.result?.data ?? []).map((ticker) => [
        String(ticker.i ?? ""),
        ticker,
      ]),
    );
    const markets = instruments.flatMap((instrument) => {
      const productId = String(instrument.symbol ?? "");
      const symbol = canonicalSymbol(instrument.base_ccy);
      const quoteCurrency = canonicalSymbol(instrument.quote_ccy);
      const ticker = tickers.get(productId);
      if (
        instrument.inst_type !== "CCY_PAIR" ||
        instrument.tradable !== true ||
        instrument.product_type !== "DIGITAL_CURRENCIES" ||
        !ticker ||
        !productId ||
        !symbol ||
        !SUPPORTED_QUOTES.has(quoteCurrency) ||
        STABLE_ASSETS.has(symbol)
      ) {
        return [];
      }
      const last = finite(ticker.a);
      const changeRatio = finite(ticker.c);
      const open = changeRatio > -1 ? last / (1 + changeRatio) : 0;
      const high = finite(ticker.h);
      const low = finite(ticker.l);
      const volumeBase = finite(ticker.v);
      if (last <= 0 || open <= 0 || high <= 0 || low <= 0 || volumeBase <= 0) {
        return [];
      }
      return [{
        venue: "crypto_com" as const,
        productId,
        symbol,
        quoteCurrency,
        sourceWindow: "rolling_24h" as const,
        last,
        open,
        high,
        low,
        volumeBase,
        dollarVolumeUsd: finiteNullable(ticker.vv),
        bid: finiteNullable(ticker.b),
        ask: finiteNullable(ticker.k),
        tradeCount: null,
      }];
    });
    return {
      venue: "crypto_com",
      ok: true,
      markets,
      message: "Crypto.com tradable spot catalog and all-market ticker are readable.",
    };
  } catch (error: unknown) {
    return {
      venue: "crypto_com",
      ok: false,
      markets: [],
      message: safeErrorMessage(error),
    };
  }
}

async function loadCoinGeckoAttention(): Promise<AttentionLoadResult> {
  try {
    const payload = await fetchPublicJson<{
      coins?: Array<{
        item?: {
          id?: unknown;
          symbol?: unknown;
          score?: unknown;
        };
      }>;
    }>(`${COINGECKO_ORIGIN}/search/trending`, 300);
    const items = (payload.coins ?? []).flatMap(({ item }, index) => {
      const symbol = canonicalSymbol(item?.symbol);
      const coinId = String(item?.id ?? "").trim();
      const providerRank = finite(item?.score);
      if (!symbol || !coinId) return [];
      return [{
        symbol,
        coinId,
        rank: Math.max(1, Math.round(providerRank + 1 || index + 1)),
      }];
    });
    return { ok: true, items };
  } catch {
    return { ok: false, items: [] };
  }
}

export async function loadCryptoDiscoverySources(): Promise<CryptoDiscoverySources> {
  const [kraken, cryptoCom, attention] = await Promise.all([
    loadKrakenMarkets(),
    loadCryptoComMarkets(),
    loadCoinGeckoAttention(),
  ]);
  return {
    venues: [kraken, cryptoCom],
    attention,
  };
}

function buildCoinbaseMarkets(opportunities: CryptoOpportunity[]): RawVenueMarket[] {
  return opportunities.map((opportunity) => ({
    venue: "coinbase" as const,
    productId: opportunity.productId,
    symbol: canonicalSymbol(opportunity.symbol),
    quoteCurrency: "USD",
    sourceWindow: "rolling_24h" as const,
    last: opportunity.price,
    open: opportunity.price / (1 + opportunity.change24hPercent / 100),
    high: opportunity.high24h,
    low: opportunity.low24h,
    volumeBase: opportunity.volume24h,
    dollarVolumeUsd: opportunity.dollarVolume24h,
    bid: null,
    ask: null,
    tradeCount: null,
  }));
}

function quoteRatesForVenue(markets: RawVenueMarket[]) {
  const lastRates = new Map<string, number>([
    ["USD", 1],
    ["USDC", 1],
    ["USDT", 1],
    ["PYUSD", 1],
  ]);
  const openRates = new Map(lastRates);
  const directStableMarkets = markets
    .filter((market) => USD_EQUIVALENT_QUOTES.has(market.quoteCurrency))
    .sort((left, right) => right.volumeBase * right.last - left.volumeBase * left.last);
  for (const market of directStableMarkets) {
    if (!SUPPORTED_QUOTES.has(market.symbol)) continue;
    const quoteLast = lastRates.get(market.quoteCurrency);
    const quoteOpen = openRates.get(market.quoteCurrency);
    if (!quoteLast || !quoteOpen) continue;
    if (!lastRates.has(market.symbol) || !USD_EQUIVALENT_QUOTES.has(market.symbol)) {
      lastRates.set(market.symbol, market.last * quoteLast);
      openRates.set(market.symbol, market.open * quoteOpen);
    } else if (USD_EQUIVALENT_QUOTES.has(market.symbol)) {
      lastRates.set(market.symbol, market.last * quoteLast);
      openRates.set(market.symbol, market.open * quoteOpen);
    }
  }
  return { lastRates, openRates };
}

function normalizeVenueMarkets(markets: RawVenueMarket[]) {
  const byVenue = new Map<CryptoDiscoveryVenue, RawVenueMarket[]>();
  for (const market of markets) {
    const current = byVenue.get(market.venue) ?? [];
    current.push(market);
    byVenue.set(market.venue, current);
  }
  const normalized: NormalizedVenueMarket[] = [];
  for (const venueMarkets of byVenue.values()) {
    const { lastRates, openRates } = quoteRatesForVenue(venueMarkets);
    for (const market of venueMarkets) {
      const quoteLast = lastRates.get(market.quoteCurrency);
      const quoteOpen = openRates.get(market.quoteCurrency);
      if (!quoteLast || !quoteOpen || quoteLast <= 0 || quoteOpen <= 0) continue;
      const priceUsd = market.last * quoteLast;
      const openUsd = market.open * quoteOpen;
      const highUsd = market.high * Math.max(quoteLast, quoteOpen);
      const lowUsd = market.low * Math.min(quoteLast, quoteOpen);
      if (priceUsd <= 0 || openUsd <= 0 || highUsd <= 0 || lowUsd <= 0) continue;
      const dollarVolume = market.dollarVolumeUsd && market.dollarVolumeUsd > 0
        ? market.dollarVolumeUsd
        : market.volumeBase * priceUsd;
      const spreadPercent = market.bid !== null &&
          market.ask !== null &&
          market.bid > 0 &&
          market.ask >= market.bid
        ? ((market.ask - market.bid) / ((market.ask + market.bid) / 2)) * 100
        : null;
      normalized.push({
        venue: market.venue,
        productId: market.productId,
        symbol: market.symbol,
        quoteCurrency: market.quoteCurrency,
        sourceWindow: market.sourceWindow,
        priceUsd,
        openUsd,
        highUsd,
        lowUsd,
        observedMovePercent: ((priceUsd - openUsd) / openUsd) * 100,
        dollarVolume,
        spreadPercent,
        tradeCount: market.tradeCount,
      });
    }
  }
  return normalized;
}

function chooseOneMarketPerVenue(markets: NormalizedVenueMarket[]) {
  const selected = new Map<CryptoDiscoveryVenue, NormalizedVenueMarket>();
  for (const market of markets) {
    const current = selected.get(market.venue);
    if (!current || market.dollarVolume > current.dollarVolume) {
      selected.set(market.venue, market);
    }
  }
  return [...selected.values()];
}

function buildAttentionMap(items: AttentionItem[]) {
  const bySymbol = new Map<string, AttentionItem>();
  for (const item of items) {
    const current = bySymbol.get(item.symbol);
    if (!current || item.rank < current.rank) bySymbol.set(item.symbol, item);
  }
  return bySymbol;
}

export function buildCryptoShadowDiscovery({
  coinbaseOpportunities,
  sources,
  now = new Date(),
}: {
  coinbaseOpportunities: CryptoOpportunity[];
  sources: CryptoDiscoverySources;
  now?: Date;
}): {
  packet: CryptoShadowDiscovery;
  prices: CryptoDiscoveryPrice[];
} {
  const coinbaseMarkets = buildCoinbaseMarkets(coinbaseOpportunities);
  const allRawMarkets = [
    ...coinbaseMarkets,
    ...sources.venues.flatMap((result) => result.markets),
  ];
  const normalizedMarkets = normalizeVenueMarkets(allRawMarkets);
  const bySymbol = new Map<string, NormalizedVenueMarket[]>();
  for (const market of normalizedMarkets) {
    const current = bySymbol.get(market.symbol) ?? [];
    current.push(market);
    bySymbol.set(market.symbol, current);
  }
  const attentionBySymbol = buildAttentionMap(sources.attention.items);
  const assets = [...bySymbol.entries()].flatMap(([symbol, markets]) => {
    const selectedMarkets = chooseOneMarketPerVenue(markets);
    if (selectedMarkets.length === 0) return [];
    const primary = [...selectedMarkets].sort(
      (left, right) => right.dollarVolume - left.dollarVolume,
    )[0];
    const totalWeight = selectedMarkets.reduce(
      (sum, market) => sum + Math.sqrt(Math.max(1, market.dollarVolume)),
      0,
    );
    const observedMovePercent = totalWeight > 0
      ? selectedMarkets.reduce(
          (sum, market) =>
            sum + market.observedMovePercent * Math.sqrt(Math.max(1, market.dollarVolume)),
          0,
        ) / totalWeight
      : 0;
    const dollarVolume = selectedMarkets.reduce(
      (sum, market) => sum + market.dollarVolume,
      0,
    );
    const confirmingVenues = selectedMarkets.filter(
      (market) => market.observedMovePercent > 0,
    ).length;
    const dispersion = standardDeviation(
      selectedMarkets.map((market) => market.observedMovePercent),
    );
    const attention = attentionBySymbol.get(symbol) ?? null;
    const momentum = clamp(Math.max(0, observedMovePercent) * 4);
    const liquidity = liquidityScore(dollarVolume);
    const confirmationRatio = confirmingVenues / selectedMarkets.length;
    const crossVenue = selectedMarkets.length >= 2
      ? clamp(45 + confirmationRatio * 45 - dispersion * 2)
      : 30;
    const venueBreadth = clamp((selectedMarkets.length / 3) * 100);
    const attentionScore = attention
      ? clamp(100 - (attention.rank - 1) * 7)
      : 0;
    const averageSpread = selectedMarkets.flatMap((market) =>
      market.spreadPercent === null ? [] : [market.spreadPercent]
    );
    const meanSpread = averageSpread.length > 0
      ? averageSpread.reduce((sum, value) => sum + value, 0) /
        averageSpread.length
      : null;
    const riskPenalty =
      (dispersion > 8 ? Math.min(12, dispersion - 8) : 0) +
      (meanSpread !== null && meanSpread > 2 ? Math.min(10, meanSpread * 2) : 0) +
      (selectedMarkets.length === 1 ? 4 : 0);
    const proposedOpportunityScore = Math.round(clamp(
      momentum * 0.38 +
        liquidity * 0.25 +
        crossVenue * 0.18 +
        venueBreadth * 0.1 +
        attentionScore * 0.09 -
        riskPenalty,
    ));
    const sourceWindows = new Set(
      selectedMarkets.map((market) => market.sourceWindow),
    );
    const allNonUsdQuotes = selectedMarkets.every(
      (market) => !USD_EQUIVALENT_QUOTES.has(market.quoteCurrency),
    );
    const supportFlags = [
      ...(selectedMarkets.length >= 2 ? ["multi_venue_observed"] : []),
      ...(confirmingVenues >= 2 ? ["multi_venue_positive_confirmation"] : []),
      ...(dollarVolume >= 5_000_000 ? ["broad_liquidity"] : []),
      ...(attention ? ["attention_trending"] : []),
    ];
    const riskFlags = [
      ...(selectedMarkets.length === 1 ? ["single_venue_only"] : []),
      ...(dispersion >= 6 ? ["cross_venue_momentum_disagreement"] : []),
      ...(sourceWindows.size > 1 ? ["mixed_measurement_windows"] : []),
      ...(allNonUsdQuotes ? ["converted_quote_only"] : []),
      ...(meanSpread !== null && meanSpread > 1.5 ? ["wide_spread"] : []),
      ...(attention ? ["attention_symbol_match_only"] : []),
    ];
    const qualifies = Boolean(
      dollarVolume >= 250_000 &&
        proposedOpportunityScore >= 30 &&
        (
          observedMovePercent >= 1 ||
          (attention && observedMovePercent >= 0) ||
          (confirmingVenues >= 2 && observedMovePercent >= 0.5)
        ),
    );
    return [{
      assetId: `crypto:${symbol}`,
      symbol,
      entryPriceUsd: primary.priceUsd,
      observedMovePercent,
      dollarVolume,
      venueCount: selectedMarkets.length,
      confirmingVenues,
      dispersion,
      proposedOpportunityScore,
      attention,
      supportFlags,
      riskFlags,
      qualifies,
      scoreBreakdown: {
        momentum: Math.round(momentum),
        liquidity: Math.round(liquidity),
        crossVenue: Math.round(crossVenue),
        venueBreadth: Math.round(venueBreadth),
        attention: Math.round(attentionScore),
      },
      markets: selectedMarkets,
    }];
  });
  const ranked = assets
    .filter((asset) => asset.qualifies)
    .sort(
      (left, right) =>
        right.proposedOpportunityScore - left.proposedOpportunityScore ||
        right.observedMovePercent - left.observedMovePercent ||
        right.dollarVolume - left.dollarVolume,
    )
    .slice(0, DISCOVERY_CANDIDATE_LIMIT)
    .map((asset, index) => ({
      assetId: asset.assetId,
      symbol: asset.symbol,
      rank: index + 1,
      entryPriceUsd: round(asset.entryPriceUsd, 10),
      observedMovePercent: round(asset.observedMovePercent),
      dollarVolume: round(asset.dollarVolume),
      venueCount: asset.venueCount,
      venues: asset.markets.map((market) => market.venue),
      quoteCurrencies: [...new Set(
        asset.markets.map((market) => market.quoteCurrency),
      )],
      confirmingVenues: asset.confirmingVenues,
      crossVenueDispersionPercent: round(asset.dispersion),
      proposedOpportunityScore: asset.proposedOpportunityScore,
      attention: asset.attention
        ? {
            source: "coingecko_trending" as const,
            rank: asset.attention.rank,
            coinId: asset.attention.coinId,
          }
        : null,
      supportFlags: asset.supportFlags,
      riskFlags: asset.riskFlags,
      scoreBreakdown: asset.scoreBreakdown,
      markets: asset.markets.map((market) => ({
        venue: market.venue,
        productId: market.productId,
        quoteCurrency: market.quoteCurrency,
        sourceWindow: market.sourceWindow,
        priceUsd: round(market.priceUsd, 10),
        observedMovePercent: round(market.observedMovePercent),
        dollarVolume: round(market.dollarVolume),
        spreadPercent: market.spreadPercent === null
          ? null
          : round(market.spreadPercent),
        tradeCount: market.tradeCount,
      })),
    }));
  const venueMarkets: Record<CryptoDiscoveryVenue, number> = {
    coinbase: normalizedMarkets.filter((market) => market.venue === "coinbase").length,
    kraken: normalizedMarkets.filter((market) => market.venue === "kraken").length,
    crypto_com: normalizedMarkets.filter((market) => market.venue === "crypto_com").length,
  };
  const quoteMarkets = normalizedMarkets.reduce<Record<string, number>>(
    (counts, market) => ({
      ...counts,
      [market.quoteCurrency]: (counts[market.quoteCurrency] ?? 0) + 1,
    }),
    {},
  );
  const providerStatus = [
    {
      venue: "coinbase" as const,
      ok: coinbaseMarkets.length > 0,
      marketCount: venueMarkets.coinbase,
      message: coinbaseMarkets.length > 0
        ? "Coinbase canonical shortlist contributed current market data."
        : "Coinbase canonical shortlist had no usable market data.",
    },
    ...sources.venues.map((result) => ({
      venue: result.venue,
      ok: result.ok && venueMarkets[result.venue] > 0,
      marketCount: venueMarkets[result.venue],
      message: result.message,
    })),
  ];

  return {
    packet: {
      version: "crypto-multivenue-discovery-v1",
      mode: "shadow",
      authority: "none",
      generatedAt: now.toISOString(),
      candidates: ranked,
      diagnostics: {
        configuredVenues: 3,
        healthyVenues: providerStatus.filter((status) => status.ok).length,
        venueMarkets,
        quoteMarkets,
        supportedPairs: normalizedMarkets.length,
        observedAssets: assets.length,
        candidateAssets: ranked.length,
        attentionSourceHealthy: sources.attention.ok,
        attentionItems: sources.attention.items.length,
        providerFailures: providerStatus.filter((status) => !status.ok).length,
        providerStatus,
      },
    },
    prices: assets.map((asset) => ({
      assetId: asset.assetId,
      symbol: asset.symbol,
      priceUsd: round(asset.entryPriceUsd, 10),
    })),
  };
}
