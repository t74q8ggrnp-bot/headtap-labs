"use client";

import { useCallback, useState } from "react";
import HeroPriceChart from "@/app/components/market/HeroPriceChart";
import type { TradeFrameworkDisplay } from "@/lib/contracts/market";
import type { MarketChartDisplayQuote } from "@/lib/market-chart";
import type { Opportunity } from "@/lib/opportunity-model";
import OpportunityWindow from "./OpportunityWindow";
import PriceDiscoveryWindow from "./PriceDiscoveryWindow";

type OpportunityStoryProps = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  watched: boolean;
  onOpen: () => void;
  onWatch: () => void;
};

export default function OpportunityStory({
  opportunity,
  framework,
  watched,
  onOpen,
  onWatch,
}: OpportunityStoryProps) {
  const explosion = opportunity.explosionAssessment;
  const [displayQuoteState, setDisplayQuoteState] = useState<{
    symbol: string;
    quote: MarketChartDisplayQuote | null;
  }>({ symbol: opportunity.ticker, quote: null });
  const displayQuote =
    displayQuoteState.symbol === opportunity.ticker ? displayQuoteState.quote : null;
  const updateDisplayQuote = useCallback((quote: MarketChartDisplayQuote | null) => {
    setDisplayQuoteState({ symbol: opportunity.ticker, quote });
  }, [opportunity.ticker]);
  const displayPrice = displayQuote?.price ?? opportunity.price;
  const displayChange = displayQuote?.changePercent ?? opportunity.change;
  const displayLive = displayQuote?.live ?? opportunity.displayQuoteLive;

  return (
    <div className="p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-baseline gap-3 flex-wrap mb-2">
          <p className="font-mono text-[3.6rem] font-black uppercase leading-none tracking-[-0.08em] text-white">
            {opportunity.ticker}
          </p>
          <div className="flex items-center gap-2 pb-1">
            <span className="font-mono text-xl font-black text-white">${displayPrice.toFixed(displayPrice < 1 ? 4 : 2)}</span>
            <span className={`font-mono text-sm font-black ${displayChange >= 0 ? "text-green-400" : "text-red-400"}`}>
              {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)}%
            </span>
            {displayLive && (
              <span className="text-[7px] font-black uppercase tracking-[0.14em] text-green-400">
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      {explosion?.state === "price_discovery" ? (
        <PriceDiscoveryWindow assessment={explosion} compact />
      ) : framework && opportunity.eligibility?.eligible ? (
        <OpportunityWindow framework={framework} />
      ) : null}

      <HeroPriceChart
        asset="stock"
        symbol={opportunity.ticker}
        accent={opportunity.strategy === "before_the_crowd" ? "orange" : "violet"}
        compact
        onQuoteUpdate={updateDisplayQuote}
      />

      <p className="text-[11px] font-semibold leading-5 text-zinc-500">
        {opportunity.whyItMatters}
      </p>

      <div className="flex items-center gap-2.5 mt-auto pt-1">
        <button onClick={onOpen} className="rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-2.5 text-xs font-black text-violet-300 hover:bg-violet-500/12 transition">
          Full Signal Breakdown →
        </button>
        <button onClick={onWatch} className={`rounded-xl border px-4 py-2.5 text-xs font-black transition ${watched ? "border-violet-400/25 bg-violet-500/[0.07] text-violet-300" : "border-white/8 text-zinc-600 hover:text-zinc-400"}`}>
          {watched ? "★ Watching" : "☆ Watch"}
        </button>
      </div>
      <p className="text-[9px] text-zinc-800 font-semibold -mt-2">Signals are for research only, not financial advice.</p>
    </div>
  );
}
