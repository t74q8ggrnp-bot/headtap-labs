import {
  getOpportunityPresentation,
  tradeFrameworkToDisplay,
  type Opportunity,
} from "@/lib/opportunity-model";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityWindow from "./OpportunityWindow";

type MobileCardDetailProps = {
  opportunities: Opportunity[];
  currentIndex: number;
  watchlist: string[];
  setCurrentIndex: (value: number | ((index: number) => number)) => void;
  onOpen: (opportunity: Opportunity) => void;
  onWatch: (ticker: string) => void;
};

export default function MobileCardDetail({
  opportunities,
  currentIndex,
  watchlist,
  setCurrentIndex,
  onOpen,
  onWatch,
}: MobileCardDetailProps) {
  const current = opportunities[currentIndex];
  if (!current) return null;

  const view = getOpportunityPresentation(current);
  const watched = watchlist.includes(current.ticker);
  const framework = tradeFrameworkToDisplay(current.tradeFramework);

  return (
    <>
      <div className="relative flex-shrink-0 px-4 pb-3 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex gap-1.5">
              {opportunities.slice(0, 8).map((opportunity, index) => (
                <button
                  key={opportunity.ticker}
                  onClick={() => setCurrentIndex(index)}
                  aria-label={`Show ${opportunity.ticker}`}
                  className={`h-1 rounded-full transition-all ${index === currentIndex ? "w-6 bg-orange-400" : "w-2 bg-white/20"}`}
                />
              ))}
            </div>
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600">
              {currentIndex + 1} of {opportunities.length} · swipe for more
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-green-400">Live</span>
          </div>
        </div>

        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">
          {currentIndex === 0 ? "HT Top Signal" : `#${currentIndex + 1} Active Read`}
        </p>
        <h1 className="font-mono text-[5rem] font-black uppercase leading-[0.82] tracking-[-0.12em] text-white">
          {current.ticker}
        </h1>
        <div className="mt-3 inline-flex items-center rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2">
          <p className="text-base font-black text-white">{current.stage}</p>
        </div>
        <p className="mt-2 text-sm font-semibold leading-5 text-zinc-400">{current.whyItMatters}</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="font-mono text-2xl font-black text-white">${current.price.toFixed(2)}</span>
          <span className={`font-mono text-xl font-black ${current.change >= 0 ? "text-green-400" : "text-red-400"}`}>
            {current.change >= 0 ? "+" : ""}{current.change.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="flex-shrink-0 px-4 pb-3">
        <div className="rounded-2xl border border-orange-400/20 bg-orange-500/[0.04] p-4">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600">Opportunity Score</p>
              <p className="font-mono text-4xl font-black text-orange-300">{Math.round(current.opportunityScore)}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] font-black uppercase text-zinc-700">Position</p>
              <p className="text-xs font-black text-orange-300">{view.positionLabel}</p>
            </div>
          </div>
          <OpportunityMetrics opportunity={current} />
        </div>
      </div>

      {current.signals.length > 0 && (
        <div className="flex-shrink-0 px-4 pb-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Why HT Likes This</p>
            <div className="space-y-1.5">
              {current.signals.slice(0, 4).map((signal, index) => (
                <div key={`${signal}-${index}`} className="flex items-center gap-2.5">
                  <span className="text-sm font-black text-green-400">✓</span>
                  <p className="text-sm font-semibold text-zinc-200">{signal}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {framework && (
        <div className="flex-shrink-0 px-4 pb-3">
          <OpportunityWindow framework={framework} />
        </div>
      )}

      <div className="flex-shrink-0 px-4 pb-4">
        <button onClick={() => onOpen(current)} className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-black uppercase tracking-[0.08em] text-black shadow-[0_0_20px_rgba(249,115,22,0.28)]">
          View Full Analysis →
        </button>
        <button onClick={() => onWatch(current.ticker)} className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent py-3 text-sm font-black uppercase tracking-[0.08em] text-zinc-500">
          {watched ? "✓ In Watchlist" : "Add to Watchlist ☆"}
        </button>
      </div>

      <div className="flex-shrink-0 px-4 pb-24">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">Other Canonical Reads</p>
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
          {opportunities.filter((opportunity) => opportunity.ticker !== current.ticker).slice(0, 8).map((opportunity) => (
            <button key={opportunity.ticker} onClick={() => onOpen(opportunity)} className="w-28 shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left">
              <p className="font-mono text-base font-black text-white">{opportunity.ticker}</p>
              <p className={`mt-1 font-mono text-xs font-black ${opportunity.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(1)}%
              </p>
              <p className="mt-1 text-[9px] font-black text-orange-300">HT {Math.round(opportunity.opportunityScore)}</p>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
