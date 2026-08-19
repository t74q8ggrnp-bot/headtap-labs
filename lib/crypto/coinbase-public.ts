import "server-only";

import { unstable_cache } from "next/cache";
import type {
  CryptoDiscoveryPrice,
  CryptoOpportunity,
  CryptoOpportunityFeed,
  CryptoProxPacket,
} from "@/lib/crypto/contracts";
import {
  scoreCryptoOpportunity,
  type CryptoMarketSnapshot,
} from "@/lib/crypto/opportunity-engine";
import {
  buildCryptoProxPacket,
  type CryptoMinuteCandle,
  type CryptoTopOfBook,
} from "@/lib/crypto/prox";
import {
  buildCryptoShadowDiscovery,
  loadCryptoDiscoverySources,
  selectCryptoDiscoverySeedSymbols,
} from "@/lib/crypto/multi-venue-discovery";
import { isAllowedMainstreamCryptoAsset } from "@/lib/crypto/asset-policy";
import {
  applyCryptoDecisionAuthority,
  rankCryptoDecisionFrame,
} from "@/lib/crypto/decision-authority";

const COINBASE_ORIGIN = "https://api.exchange.coinbase.com";
const PROVIDER_BATCH_SIZE = 8;
const PROX_BATCH_SIZE = 6;
const SHORTLIST_LIMIT = 80;
const LIQUIDITY_ANCHORS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "SHIB",
  "LTC",
  "BCH",
  "SUI",
  "AAVE",
  "UNI",
  "DOT",
  "NEAR",
  "APT",
  "ARB",
  "OP",
  "PEPE",
];

type CoinbaseProduct = {
  id?: unknown;
  base_currency?: unknown;
  quote_currency?: unknown;
  status?: unknown;
  trading_disabled?: unknown;
  cancel_only?: unknown;
  post_only?: unknown;
  limit_only?: unknown;
  auction_mode?: unknown;
  fx_stablecoin?: unknown;
};

type CoinbaseVolume = {
  id?: unknown;
  base_currency?: unknown;
  quote_currency?: unknown;
  market_types?: unknown;
  spot_volume_24hour?: unknown;
  spot_volume_30day?: unknown;
};

type CoinbaseStats = {
  open?: unknown;
  high?: unknown;
  low?: unknown;
  last?: unknown;
  volume?: unknown;
  volume_30day?: unknown;
};

type CoinbaseTicker = {
  price?: unknown;
  bid?: unknown;
  ask?: unknown;
  time?: unknown;
};

const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function fetchCoinbase<T>(path: string, revalidate: number): Promise<T> {
  const response = await fetch(`${COINBASE_ORIGIN}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "HT-Labs-Crypto-Research/1.0",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Coinbase ${path} failed with ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseCandles(payload: unknown): CryptoMinuteCandle[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw) => {
    if (!Array.isArray(raw) || raw.length < 6) return [];
    const candle = {
      time: finite(raw[0]),
      low: finite(raw[1]),
      high: finite(raw[2]),
      open: finite(raw[3]),
      close: finite(raw[4]),
      volume: finite(raw[5]),
    };
    return candle.time > 0 && candle.close > 0 ? [candle] : [];
  }).sort((left, right) => left.time - right.time);
}

function parseTopOfBook(payload: CoinbaseTicker): CryptoTopOfBook | null {
  const price = finite(payload.price);
  const bid = finite(payload.bid);
  const ask = finite(payload.ask);
  if (price <= 0 || bid <= 0 || ask < bid) return null;
  return {
    price,
    bid,
    ask,
    time: typeof payload.time === "string" ? payload.time : null,
  };
}

async function fetchCryptoCandles(productId: string) {
  const payload = await fetchCoinbase<unknown>(
    `/products/${encodeURIComponent(productId)}/candles?granularity=60`,
    60,
  );
  return parseCandles(payload);
}

async function fetchCryptoTopOfBook(productId: string) {
  const payload = await fetchCoinbase<CoinbaseTicker>(
    `/products/${encodeURIComponent(productId)}/ticker`,
    30,
  );
  return parseTopOfBook(payload);
}

async function loadCryptoProxPackets(opportunities: CryptoOpportunity[]) {
  const packets = new Map<string, CryptoProxPacket>();
  const candidates = opportunities.filter(
    (opportunity) => opportunity.eligible || opportunity.radarEligible,
  );
  let providerFailures = 0;
  let benchmarkCandles: CryptoMinuteCandle[] = [];
  try {
    benchmarkCandles = await fetchCryptoCandles("BTC-USD");
  } catch {
    providerFailures++;
  }

  for (let index = 0; index < candidates.length; index += PROX_BATCH_SIZE) {
    const batch = candidates.slice(index, index + PROX_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (opportunity) => {
        const [candles, quote] = await Promise.all([
          fetchCryptoCandles(opportunity.productId),
          fetchCryptoTopOfBook(opportunity.productId),
        ]);
        return buildCryptoProxPacket({
          opportunity,
          candles,
          benchmarkCandles,
          quote,
        });
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        packets.set(result.value.productId, result.value);
      } else {
        providerFailures++;
      }
    }
    if (index + PROX_BATCH_SIZE < candidates.length) await delay(500);
  }

  return {
    packets,
    evaluatedProducts: candidates.length,
    providerFailures,
  };
}

function selectProducts(
  products: CoinbaseProduct[],
  volumes: CoinbaseVolume[],
  discoverySymbols: string[],
) {
  const available = new Map(
    products.flatMap((product) => {
      const id = String(product.id ?? "");
      const symbol = String(product.base_currency ?? "").toUpperCase();
      const quote = String(product.quote_currency ?? "").toUpperCase();
      const isAvailable =
        id &&
        symbol &&
        quote === "USD" &&
        product.status === "online" &&
        product.trading_disabled !== true &&
        product.cancel_only !== true &&
        product.post_only !== true &&
        product.limit_only !== true &&
        product.auction_mode !== true &&
        product.fx_stablecoin !== true &&
        isAllowedMainstreamCryptoAsset(symbol);
      return isAvailable ? [[id, { id, symbol }] as const] : [];
    }),
  );
  const rankedVolumes = volumes.flatMap((volume) => {
    const id = String(volume.id ?? "");
    const product = available.get(id);
    const marketTypes = Array.isArray(volume.market_types)
      ? volume.market_types.map(String)
      : [];
    if (
      !product ||
      String(volume.quote_currency ?? "").toUpperCase() !== "USD" ||
      !marketTypes.includes("spot")
    ) {
      return [];
    }
    const volume24h = finite(volume.spot_volume_24hour);
    const volume30d = finite(volume.spot_volume_30day);
    const relativeVolume =
      volume30d > 0 ? volume24h / (volume30d / 30) : 0;
    return [{ ...product, volume24h, volume30d, relativeVolume }];
  });

  const selected = new Map<
    string,
    (typeof rankedVolumes)[number]
  >();
  const add = (item: (typeof rankedVolumes)[number] | undefined) => {
    if (item) selected.set(item.id, item);
  };
  for (const symbol of LIQUIDITY_ANCHORS) {
    add(rankedVolumes.find((item) => item.symbol === symbol));
  }
  for (const symbol of discoverySymbols) {
    add(rankedVolumes.find((item) => item.symbol === symbol));
  }
  [...rankedVolumes]
    .sort((left, right) => right.relativeVolume - left.relativeVolume)
    .slice(0, 40)
    .forEach(add);
  [...rankedVolumes]
    .sort((left, right) => right.volume24h - left.volume24h)
    .slice(0, 30)
    .forEach(add);

  return {
    availableCount: available.size,
    selected: [...selected.values()].slice(0, SHORTLIST_LIMIT),
  };
}

export type CryptoOpportunityFeedState = {
  feed: CryptoOpportunityFeed;
  discoveryPrices: CryptoDiscoveryPrice[];
};

async function buildUncachedCryptoOpportunityFeedState(): Promise<CryptoOpportunityFeedState> {
  const [products, volumes, discoverySources] = await Promise.all([
    fetchCoinbase<CoinbaseProduct[]>("/products", 300),
    fetchCoinbase<CoinbaseVolume[]>("/products/volume-summary", 60),
    loadCryptoDiscoverySources(),
  ]);
  const discoverySymbols = selectCryptoDiscoverySeedSymbols(discoverySources);
  const { availableCount, selected } = selectProducts(
    products,
    volumes,
    discoverySymbols,
  );
  const snapshots: CryptoMarketSnapshot[] = [];
  let providerFailures = 0;

  for (let index = 0; index < selected.length; index += PROVIDER_BATCH_SIZE) {
    const batch = selected.slice(index, index + PROVIDER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (product) => {
        const stats = await fetchCoinbase<CoinbaseStats>(
          `/products/${encodeURIComponent(product.id)}/stats`,
          60,
        );
        return {
          productId: product.id,
          symbol: product.symbol,
          open: finite(stats.open),
          high: finite(stats.high),
          low: finite(stats.low),
          last: finite(stats.last),
          volume24h: finite(stats.volume) || product.volume24h,
          volume30d: finite(stats.volume_30day) || product.volume30d,
        } satisfies CryptoMarketSnapshot;
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") snapshots.push(result.value);
      else providerFailures++;
    }
    if (index + PROVIDER_BATCH_SIZE < selected.length) await delay(1_000);
  }

  const baseEvaluated = snapshots
    .map(scoreCryptoOpportunity)
    .filter((item) => item !== null)
    .sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        right.opportunityScore - left.opportunityScore ||
        right.dollarVolume24h - left.dollarVolume24h,
    );
  const prox = await loadCryptoProxPackets(baseEvaluated);
  const proxEvaluated = baseEvaluated.map((opportunity) => ({
    ...opportunity,
    proxIntelligence: prox.packets.get(opportunity.productId) ?? null,
  }));
  const now = new Date();
  const shadowDiscovery = buildCryptoShadowDiscovery({
    coinbaseOpportunities: baseEvaluated,
    sources: discoverySources,
    now,
  });
  const authorityEvaluated = applyCryptoDecisionAuthority({
    opportunities: proxEvaluated,
    discovery: shadowDiscovery.packet,
  });
  const ranked = rankCryptoDecisionFrame(authorityEvaluated);
  const decisionAt = now.toISOString();
  const freshUntil = new Date(now.getTime() + 7 * 60_000).toISOString();

  return {
    feed: {
      success: true,
      lane: "crypto_momentum",
      status: "observation_only",
      provider: "centralized_exchange_public",
      methodologyVersion: "crypto-momentum-v3-prox-authority",
      decisionFrame: {
        version: "crypto-decision-frame-v1",
        decisionAt,
        freshUntil,
        fresh: true,
        source: "computed",
        authority: "backend_atomic",
      },
      hero: ranked.hero,
      contenders: ranked.contenders,
      radar: ranked.radar,
      shadowDiscovery: shadowDiscovery.packet,
      diagnostics: {
        availableUsdProducts: availableCount,
        shortlistedProducts: selected.length,
        evaluatedProducts: ranked.evaluated.length,
        eligibleProducts: ranked.authorityEligibleProducts,
        radarProducts: ranked.radar.length,
        providerFailures,
        discoverySeedProducts: discoverySymbols.length,
        authorityEligibleProducts: ranked.authorityEligibleProducts,
        withheldProducts: ranked.withheldProducts,
        staleProxProducts: ranked.staleProxProducts,
        proxEvaluatedProducts: prox.evaluatedProducts,
        proxAvailableProducts: prox.packets.size,
        proxProviderFailures: prox.providerFailures,
        shadowDiscoveryAssets:
          shadowDiscovery.packet.diagnostics.observedAssets,
        shadowDiscoveryCandidates:
          shadowDiscovery.packet.diagnostics.candidateAssets,
        shadowDiscoveryHealthyVenues:
          shadowDiscovery.packet.diagnostics.healthyVenues,
        shadowDiscoveryProviderFailures:
          shadowDiscovery.packet.diagnostics.providerFailures,
      },
      timestamp: decisionAt,
    },
    discoveryPrices: shadowDiscovery.prices,
  };
}

const buildCachedCryptoOpportunityFeedState = unstable_cache(
  buildUncachedCryptoOpportunityFeedState,
  ["ht-crypto-opportunity-feed-v5-prox-authority"],
  {
    revalidate: 60,
    tags: ["ht-crypto-opportunities"],
  },
);

export async function buildCryptoOpportunityFeedState() {
  return buildCachedCryptoOpportunityFeedState();
}

export async function buildFreshCryptoOpportunityFeedState() {
  return buildUncachedCryptoOpportunityFeedState();
}

export async function buildCryptoOpportunityFeed() {
  return (await buildCachedCryptoOpportunityFeedState()).feed;
}

export async function loadCoinbaseCurrentPrices(productIds: string[]) {
  const uniqueProductIds = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  const prices = new Map<string, number>();
  for (let index = 0; index < uniqueProductIds.length; index += PROVIDER_BATCH_SIZE) {
    const batch = uniqueProductIds.slice(index, index + PROVIDER_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (productId) => ({
        productId,
        quote: await fetchCryptoTopOfBook(productId),
      })),
    );
    for (const result of settled) {
      if (
        result.status === "fulfilled" &&
        result.value.quote &&
        result.value.quote.price > 0
      ) {
        prices.set(result.value.productId, result.value.quote.price);
      }
    }
    if (index + PROVIDER_BATCH_SIZE < uniqueProductIds.length) await delay(500);
  }
  return prices;
}
