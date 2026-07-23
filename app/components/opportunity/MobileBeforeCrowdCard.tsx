import type { DecisionTraceDisplay, TradeFrameworkDisplay } from "@/lib/contracts/market";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";
import DecisionTrace from "./DecisionTrace";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityWindow from "./OpportunityWindow";

type MobileBeforeCrowdCardProps = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  trace: DecisionTraceDisplay | null;
  dualEngine: boolean;
  watched: boolean;
  onOpen: () => void;
  onWatch: () => void;
};

export default function MobileBeforeCrowdCard({
  opportunity,
  framework,
  trace,
  dualEngine,
  watched,
  onOpen,
  onWatch,
}: MobileBeforeCrowdCardProps) {
  const view = getOpportunityPresentation(opportunity);
  const catalyst = opportunity.catalystTags[0] ?? null;

  return (
    <div className="mx-4 mb-3 flex-shrink-0 overflow-hidden rounded-2xl border border-orange-400/15 bg-black">
      <div className="flex items-center justify-between px-5 pb-0 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]" />
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-orange-400">Before The Crowd</p>
        </div>
        {dualEngine && <span className="text-[8px] font-black text-amber-400">⚡ Dual Signal</span>}
      </div>

      <div className="border-b border-white/8 px-5 pb-4 pt-3">
        <div className="flex items-end gap-3">
          <p className="font-mono text-[3.2rem] font-black leading-none tracking-[-0.06em] text-white">{opportunity.ticker}</p>
          <div className="pb-1.5">
            <span className="font-mono text-base font-black text-white">${opportunity.price.toFixed(2)}</span>
            <span className={`ml-2 font-mono text-xs font-black ${opportunity.change >= 0 ? "text-green-400" : "text-red-400"}`}>
              {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(2)}%
            </span>
          </div>
        </div>
        <p className="mt-3 text-2xl font-black leading-tight text-orange-300">{opportunity.stage}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-zinc-600">{opportunity.whyItMatters}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {catalyst && (
            <span className="mt-2 inline-flex rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-[9px] font-black text-orange-300">
              ⚡ {catalyst}
            </span>
          )}
          {opportunity.riskTags.map((tag) => (
            <span key={tag} className="mt-2 inline-flex rounded-full border border-red-400/25 bg-red-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-red-300">
              ⚠ {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="border-b border-white/8 px-5 py-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-600">Opportunity Score</p>
            <p className="font-mono text-[2rem] font-black leading-none text-orange-400">{Math.round(opportunity.opportunityScore)}</p>
          </div>
          <div className="text-right">
            <p className="text-[7px] font-black uppercase text-zinc-700">Position</p>
            <p className="text-[10px] font-black text-orange-300">{view.positionLabel}</p>
          </div>
        </div>
        <OpportunityMetrics opportunity={opportunity} />
      </div>

      {opportunity.signals.length > 0 && (
        <div className="border-b border-white/8 px-5 py-4">
          <p className="mb-2.5 text-[8px] font-black uppercase tracking-[0.22em] text-orange-400">Why HT Labs Selected This</p>
          <div className="space-y-2">
            {opportunity.signals.slice(0, 4).map((signal, index) => (
              <div key={`${signal}-${index}`} className="flex gap-2.5">
                <span className="shrink-0 text-[10px] font-black text-orange-400">✓</span>
                <p className="text-xs font-semibold leading-5 text-zinc-200">{signal}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {framework && (
        <div className="border-b border-white/8 px-5 py-4">
          <OpportunityWindow framework={framework} />
        </div>
      )}

      {trace && (
        <div className="border-b border-white/8 px-5 py-3">
          <DecisionTrace trace={trace} />
        </div>
      )}

      <div className="px-5 py-4">
        <div className="flex gap-2">
          <button onClick={onOpen} className="flex-1 rounded-xl border border-orange-400/30 bg-orange-500/10 py-2.5 text-xs font-black text-orange-300">
            See Why HT Labs Picked This →
          </button>
          <button onClick={onWatch} className={`rounded-xl border px-4 py-2.5 text-xs font-black transition ${watched ? "border-orange-400/30 bg-orange-500/10 text-orange-300" : "border-white/10 bg-white/[0.03] text-zinc-500"}`}>
            {watched ? "★" : "☆"}
          </button>
        </div>
        <p className="mt-2.5 text-center text-[8px] font-semibold text-zinc-700">Signals are for research only, not financial advice.</p>
      </div>
    </div>
  );
}
