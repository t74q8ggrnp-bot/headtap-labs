import type {
  MassiveLastQuote,
  MassiveTradePrint,
} from "@/lib/massive-stocks";

export const PROX_MICROSTRUCTURE_VERSION =
  "prox-microstructure-observation-v1";
export const PROX_MICROSTRUCTURE_AUTHORITY = "shadow_observation_only";

export type ProxMicrostructureSummary = {
  ticker: string;
  quoteAsOf: string | null;
  tradeAsOf: string | null;
  marketAsOf: string | null;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  midpointPrice: number | null;
  spreadDollars: number | null;
  spreadPercent: number | null;
  lastTradePrice: number | null;
  lastTradeSize: number | null;
  recentTradeCount: number;
  recentTradeVolume: number;
  recentTradeNotional: number;
  largestTradeSize: number;
  largestTradeNotional: number;
  exchangeCount: number;
  conditionCodes: number[];
};

const round = (value: number, decimals: number) =>
  Number(value.toFixed(decimals));

const latestTimestamp = (values: Array<string | null>) => {
  const valid = values
    .map((value) => ({ value, timestamp: value ? new Date(value).getTime() : NaN }))
    .filter(
      (entry): entry is { value: string; timestamp: number } =>
        Boolean(entry.value) && Number.isFinite(entry.timestamp),
    )
    .sort((left, right) => right.timestamp - left.timestamp);
  return valid[0]?.value ?? null;
};

/**
 * Normalize direct NBBO and consolidated trade prints into append-only facts.
 * This module deliberately exports no score, rank, eligibility, or execution
 * fields so the evidence cannot become a second public decision path.
 */
export function summarizeProxMicrostructure(input: {
  ticker: string;
  quote: MassiveLastQuote | null;
  trades: MassiveTradePrint[];
}): ProxMicrostructureSummary {
  const trades = [...input.trades].sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
  const lastTrade = trades.at(-1) ?? null;
  const bid = input.quote?.bid ?? null;
  const ask = input.quote?.ask ?? null;
  const validMarket = bid !== null && ask !== null && ask >= bid;
  const midpoint = validMarket ? (bid + ask) / 2 : null;
  const spread = validMarket ? ask - bid : null;
  const recentTradeVolume = trades.reduce((sum, trade) => sum + trade.size, 0);
  const recentTradeNotional = trades.reduce(
    (sum, trade) => sum + trade.price * trade.size,
    0,
  );
  const largestTradeSize = trades.reduce(
    (largest, trade) => Math.max(largest, trade.size),
    0,
  );
  const largestTradeNotional = trades.reduce(
    (largest, trade) => Math.max(largest, trade.price * trade.size),
    0,
  );
  const exchanges = new Set(
    trades
      .map((trade) => trade.exchange)
      .filter((exchange): exchange is number => exchange !== null),
  );
  const conditionCodes = [...new Set(trades.flatMap((trade) => trade.conditions))]
    .sort((left, right) => left - right);
  const tradeAsOf = lastTrade?.timestamp ?? null;
  const quoteAsOf = input.quote?.timestamp ?? null;

  return {
    ticker: input.ticker.trim().toUpperCase(),
    quoteAsOf,
    tradeAsOf,
    marketAsOf: latestTimestamp([quoteAsOf, tradeAsOf]),
    bidPrice: bid,
    askPrice: ask,
    bidSize: input.quote?.bidSize ?? null,
    askSize: input.quote?.askSize ?? null,
    midpointPrice: midpoint === null ? null : round(midpoint, 6),
    spreadDollars: spread === null ? null : round(spread, 6),
    spreadPercent:
      spread === null || midpoint === null || midpoint <= 0
        ? null
        : round((spread / midpoint) * 100, 6),
    lastTradePrice: lastTrade?.price ?? null,
    lastTradeSize: lastTrade?.size ?? null,
    recentTradeCount: trades.length,
    recentTradeVolume: round(recentTradeVolume, 6),
    recentTradeNotional: round(recentTradeNotional, 2),
    largestTradeSize: round(largestTradeSize, 6),
    largestTradeNotional: round(largestTradeNotional, 2),
    exchangeCount: exchanges.size,
    conditionCodes,
  };
}
