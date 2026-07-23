import type { MarketStock } from "@/lib/contracts/market";
import type { Opportunity } from "@/lib/opportunity-model";

type MobileWatchlistProps = {
  tickers: string[];
  stocks: MarketStock[];
  opportunities: Opportunity[];
  onOpenStock: (stock: MarketStock) => void;
  onOpenOpportunity: (opportunity: Opportunity) => void;
};

export default function MobileWatchlist({
  tickers,
  stocks,
  opportunities,
  onOpenStock,
  onOpenOpportunity,
}: MobileWatchlistProps) {
  const stockByTicker = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const opportunityByTicker = new Map(opportunities.map((opportunity) => [opportunity.ticker, opportunity]));

  return (
    <div className="h-full overflow-y-auto px-4 pb-24 pt-12">
      <p className="mb-4 text-[11px] font-black uppercase tracking-[0.24em] text-orange-300">My Watchlist</p>
      {tickers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 pt-16">
          <p className="text-5xl">⭐</p>
          <p className="text-base font-black text-white">No tickers yet</p>
          <p className="text-center text-sm font-semibold text-zinc-500">Go to Scanner and add names you want to track</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickers.map((ticker) => {
            const opportunity = opportunityByTicker.get(ticker);
            const stock = stockByTicker.get(ticker);
            const price = opportunity?.price ?? stock?.price ?? 0;
            const change = opportunity?.change ?? stock?.change ?? 0;
            return (
              <button
                key={ticker}
                onClick={() => opportunity ? onOpenOpportunity(opportunity) : stock && onOpenStock(stock)}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <div className="text-left">
                  <p className="font-mono text-lg font-black text-white">{ticker}</p>
                  <p className="text-[10px] font-semibold text-zinc-500">{opportunity?.stage ?? "Watchlist"}</p>
                </div>
                <div className="text-right">
                  {price > 0 && <p className="font-mono text-[10px] font-semibold text-zinc-600">${price.toFixed(2)}</p>}
                  <p className={`font-mono text-base font-black ${change >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                  </p>
                  <p className="text-[10px] font-black text-orange-300">
                    {opportunity ? `HT ${Math.round(opportunity.opportunityScore)}` : "Not ranked"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
