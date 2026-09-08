import type { CoinApiBar, CoinApiBook, CoinApiMarket, CoinApiTrade } from "./coinapi-normalize";
import type { CryptoLiveResearchInput } from "./live-research";

/** Adapter only: no network calls, existing public scores, or fabricated freshness. */
export function coinApiResearchEvidence({ market, trade, book, bars, decisionAt, recentTrades = [] }: {
  market: CoinApiMarket;
  trade: CoinApiTrade;
  book: CoinApiBook | null;
  bars: CoinApiBar[];
  decisionAt: string;
  recentTrades?: CoinApiTrade[];
}): CryptoLiveResearchInput {
  if (market.quote !== "USD" || market.symbolId !== `${market.venue}_SPOT_${market.base}_USD` ||
      trade.symbolId !== market.symbolId || (book && book.symbolId !== market.symbolId) ||
      recentTrades.some(row => row.symbolId !== market.symbolId)) throw new Error("Crypto research market identity mismatch.");
  return {
    identity: { provider: "coinapi", marketId: market.symbolId, base: market.base, quote: "USD" },
    decisionAt,
    trade: { price: trade.price, asOf: trade.asOf },
    book: book ? { bid: book.bid, ask: book.ask, asOf: book.asOf } : null,
    candles: bars.map(bar => ({ time: bar.time, asOf: bar.closeAsOf,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })),
    // These endpoints do not supply explicit exchange halt/status evidence.
    marketState: "unavailable",
    recentTrades: recentTrades.map(row => ({ price: row.price, asOf: row.asOf })),
  };
}
