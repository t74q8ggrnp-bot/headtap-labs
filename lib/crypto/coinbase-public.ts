import "server-only";

import { unstable_cache } from "next/cache";
import type { CryptoOpportunityFeed } from "@/lib/crypto/contracts";
import {
  scoreCryptoOpportunity,
  type CryptoMarketSnapshot,
} from "@/lib/crypto/opportunity-engine";

const COINBASE_ORIGIN = "https://api.exchange.coinbase.com";
const PROVIDER_BATCH_SIZE = 8;
const SHORTLIST_LIMIT = 80;
const STABLE_BASE_ASSETS = new Set([
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

function selectProducts(
  products: CoinbaseProduct[],
  volumes: CoinbaseVolume[],
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
        !STABLE_BASE_ASSETS.has(symbol);
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

async function buildUncachedCryptoOpportunityFeed(): Promise<CryptoOpportunityFeed> {
  const [products, volumes] = await Promise.all([
    fetchCoinbase<CoinbaseProduct[]>("/products", 300),
    fetchCoinbase<CoinbaseVolume[]>("/products/volume-summary", 60),
  ]);
  const { availableCount, selected } = selectProducts(products, volumes);
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

  const evaluated = snapshots
    .map(scoreCryptoOpportunity)
    .filter((item) => item !== null)
    .sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        right.opportunityScore - left.opportunityScore ||
        right.dollarVolume24h - left.dollarVolume24h,
    );
  const eligible = evaluated.filter((item) => item.eligible);
  const radar = evaluated
    .filter((item) => item.radarEligible)
    .slice(0, 6);

  return {
    success: true,
    lane: "crypto_momentum",
    status: "observation_only",
    provider: "coinbase_exchange_public",
    methodologyVersion: "crypto-momentum-v1",
    hero: eligible[0] ?? null,
    contenders: eligible.slice(1, 6),
    radar,
    diagnostics: {
      availableUsdProducts: availableCount,
      shortlistedProducts: selected.length,
      evaluatedProducts: evaluated.length,
      eligibleProducts: eligible.length,
      radarProducts: radar.length,
      providerFailures,
    },
    timestamp: new Date().toISOString(),
  };
}

export const buildCryptoOpportunityFeed = unstable_cache(
  buildUncachedCryptoOpportunityFeed,
  ["ht-crypto-opportunity-feed-v1"],
  {
    revalidate: 60,
    tags: ["ht-crypto-opportunities"],
  },
);
