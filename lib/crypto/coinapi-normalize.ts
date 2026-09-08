import type { MarketChartBar } from "../market-chart";

export const COINAPI_VENUES = ["COINBASE", "KRAKEN", "CRYPTOCOM"] as const;
export type CoinApiVenue = (typeof COINAPI_VENUES)[number];
export type CoinApiMarket = {
  symbolId: string;
  venue: CoinApiVenue;
  base: string;
  quote: string;
  // Catalog statistics are historical metadata, NEVER a live quote.
  catalogAsOf: string | null;
  volume30d: number | null;
};
export type CoinApiTrade = {
  symbolId: string;
  price: number;
  size: number | null;
  asOf: string;
  receivedByProviderAt: string | null;
};
export type CoinApiBook = {
  symbolId: string;
  bid: number;
  ask: number;
  asOf: string;
  receivedByProviderAt?: string | null;
  bidSize?: number | null;
  askSize?: number | null;
};
export type CoinApiBar = MarketChartBar & { closeAsOf: string };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function usableTime(value: unknown, now: number): string | null {
  const time = timestamp(value);
  return time && Date.parse(time) > 0 && Date.parse(time) <= now + 2_000 ? time : null;
}

/** Preserve venue + spot pair identity; symbols alone are not execution identities. */
export function parseCoinApiMarkets(payload: unknown, venue: CoinApiVenue): CoinApiMarket[] {
  if (!Array.isArray(payload)) throw new Error("CoinAPI market catalog is malformed.");
  const markets = new Map<string, CoinApiMarket>();
  for (const raw of payload) {
    const row = object(raw);
    const base = typeof row.asset_id_base === "string" ? row.asset_id_base : "";
    const quote = typeof row.asset_id_quote === "string" ? row.asset_id_quote : "";
    if (row.exchange_id !== venue || row.symbol_type !== "SPOT" ||
        !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(base) || !/^[A-Z0-9]{2,10}$/.test(quote) ||
        row.symbol_id !== `${venue}_SPOT_${base}_${quote}`) continue;
    const volume = numeric(row.volume_1mth);
    markets.set(row.symbol_id, {
      symbolId: row.symbol_id, venue, base, quote,
      catalogAsOf: timestamp(row.data_trade_end),
      volume30d: volume !== null && volume > 0 ? volume : null,
    });
  }
  return [...markets.values()];
}

/** One deterministic native USD market for a display key. Never relabel USDT as USD. */
export function resolveCoinApiUsdMarket(markets: CoinApiMarket[], productId: string): CoinApiMarket {
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}-USD$/.test(productId)) throw new Error("Invalid USD crypto product.");
  const base = productId.slice(0, -4);
  const candidates = markets.filter(market => market.base === base && market.quote === "USD");
  candidates.sort((left, right) => COINAPI_VENUES.indexOf(left.venue) - COINAPI_VENUES.indexOf(right.venue));
  if (!candidates.length) throw new Error("CoinAPI native USD market is not verified for this asset.");
  return candidates[0];
}

export function parseCoinApiTrade(payload: unknown, symbolId: string, now: number): CoinApiTrade {
  const row = object(payload);
  const price = numeric(row.price);
  const size = numeric(row.size);
  const asOf = usableTime(row.time_exchange, now);
  if (row.symbol_id !== symbolId || price === null || price <= 0 || !asOf) {
    throw new Error("CoinAPI trade identity, price or provider timestamp is invalid.");
  }
  return { symbolId, price, size: size !== null && size >= 0 ? size : null, asOf,
    receivedByProviderAt: usableTime(row.time_coinapi, now) };
}

export function parseCoinApiBook(payload: unknown, symbolId: string, now: number): CoinApiBook {
  const row = object(payload);
  const bid = numeric(row.bid_price);
  const ask = numeric(row.ask_price);
  const asOf = usableTime(row.time_exchange, now);
  if (row.symbol_id !== symbolId || bid === null || ask === null || bid <= 0 || ask < bid || !asOf) {
    throw new Error("CoinAPI quote identity, spread or provider timestamp is invalid.");
  }
  const bidSize = numeric(row.bid_size), askSize = numeric(row.ask_size);
  return { symbolId, bid, ask, asOf,
    receivedByProviderAt: usableTime(row.time_coinapi, now),
    bidSize: bidSize !== null && bidSize >= 0 ? bidSize : null,
    askSize: askSize !== null && askSize >= 0 ? askSize : null };
}

export function parseCoinApiBars(payload: unknown, now: number): CoinApiBar[] {
  if (!Array.isArray(payload)) throw new Error("CoinAPI candles are malformed.");
  const bars = new Map<number, CoinApiBar>();
  for (const raw of payload) {
    const row = object(raw);
    const start = usableTime(row.time_period_start, now);
    const end = timestamp(row.time_period_end);
    const closeAsOf = usableTime(row.time_close, now);
    const openAt = usableTime(row.time_open, now);
    const open = numeric(row.price_open), high = numeric(row.price_high);
    const low = numeric(row.price_low), close = numeric(row.price_close);
    const volume = numeric(row.volume_traded);
    if (!start || !end || !closeAsOf || !openAt ||
        Date.parse(end) - Date.parse(start) !== 60_000 ||
        Date.parse(start) % 60_000 !== 0 ||
        Date.parse(openAt) < Date.parse(start) || Date.parse(openAt) > Date.parse(closeAsOf) ||
        Date.parse(closeAsOf) >= Date.parse(end) ||
        open === null || high === null || low === null || close === null || volume === null ||
        Math.min(open, high, low, close) <= 0 || volume < 0 ||
        high < Math.max(open, low, close) || low > Math.min(open, high, close)) continue;
    const time = Date.parse(start) / 1_000;
    const previous = bars.get(time);
    if (previous && previous.closeAsOf === closeAsOf &&
        (previous.open !== open || previous.high !== high || previous.low !== low ||
         previous.close !== close || previous.volume !== volume)) {
      throw new Error("CoinAPI conflicting candle version.");
    }
    if (!previous || Date.parse(previous.closeAsOf) <= Date.parse(closeAsOf)) {
      bars.set(time, { time, open, high, low, close, volume, closeAsOf });
    }
  }
  return [...bars.values()].sort((left, right) => left.time - right.time);
}

/** Quote + last candle are emitted atomically from ONE market. No invented prints/volume. */
export function buildCoinApiChart(market: CoinApiMarket, sourceBars: CoinApiBar[], trade: CoinApiTrade, now: number) {
  if (market.quote !== "USD" || trade.symbolId !== market.symbolId) throw new Error("CoinAPI chart market mismatch.");
  const bars = sourceBars.filter(bar => bar.time * 1_000 >= now - 86_460_000)
    .map(bar => ({ ...bar }));
  const latest = bars.at(-1);
  if (!latest || bars.length < 2) throw new Error("CoinAPI candle history is insufficient.");
  const previousCloseAsOf = latest.closeAsOf;
  const tradeTime = Date.parse(trade.asOf);
  const tradeBucket = Math.floor(tradeTime / 60_000) * 60;
  const useTrade = tradeTime >= Date.parse(latest.closeAsOf) && tradeTime <= now + 2_000;
  if (useTrade) {
    if (tradeBucket === latest.time) {
      latest.close = trade.price;
      latest.high = Math.max(latest.high, trade.price);
      latest.low = Math.min(latest.low, trade.price);
      latest.closeAsOf = trade.asOf;
    } else if (tradeBucket > latest.time) {
      bars.push({ time: tradeBucket, open: trade.price, high: trade.price, low: trade.price,
        close: trade.price, volume: 0, closeAsOf: trade.asOf });
    }
  }
  const last = bars.at(-1)!;
  const asOf = useTrade ? trade.asOf : last.closeAsOf;
  return {
    bars: bars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume })),
    displayQuote: {
      price: last.close, asOf,
      changePercent: (last.close / bars[0].open - 1) * 100,
      changeBasis: "chart_open" as const,
      live: now - Date.parse(asOf) <= 30_000 && Date.parse(asOf) <= now + 2_000,
      source: useTrade ? "coinapi_crypto_trade" as const : "coinapi_crypto_aggregate" as const,
      marketSymbolId: market.symbolId,
    },
    intervalSeconds: 60,
    sourceLabel: `CoinAPI · ${market.venue} ${market.base}/USD · 1-minute candles`,
    marketSymbolId: market.symbolId,
    volumeProvisional: useTrade && tradeTime > Date.parse(previousCloseAsOf),
  };
}
