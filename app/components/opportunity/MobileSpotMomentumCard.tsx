import type { DecisionTraceDisplay, TradeFrameworkDisplay } from "@/lib/contracts/market";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";
import DecisionTrace from "./DecisionTrace";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityWindow from "./OpportunityWindow";

type MobileSpotMomentumCardProps = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  trace: DecisionTraceDisplay | null;
  narrative: string | null;
  dualEngine: boolean;
  watched: boolean;
  onOpen: () => void;
  onWatch: () => void;
};

export default function MobileSpotMomentumCard({
  opportunity,
  framework,
  trace,
  narrative,
  dualEngine,
  watched,
  onOpen,
  onWatch,
}: MobileSpotMomentumCardProps) {
  const view = getOpportunityPresentation(opportunity);
  const catalyst = opportunity.catalystTags[0] ?? null;

  return (
    <div className="mx-4 mb-3 mt-4 flex-shrink-0 overflow-hidden rounded-2xl border border-violet-400/15 bg-black">
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]" />
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-violet-400">Top Opportunity</p>
        </div>
        {dualEngine && <span className="text-[8px] font-black text-amber-400">⚡ Dual Signal</span>}
      </div>

      <div className="border-b border-white/8 px-5 pb-4">
        <div className="mb-2 flex items-end gap-3">
          <p className="font-mono text-[3.2rem] font-black leading-none tracking-[-0.06em] text-white">{opportunity.ticker}</p>
          <div className="pb-1">
            <span className="font-mono text-base font-black text-white">${opportunity.price.toFixed(2)}</span>
            <span className={`ml-2 font-mono text-xs font-black ${opportunity.change >= 0 ? "text-green-400" : "text-red-400"}`}>
              {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[9px] font-black text-zinc-400">{opportunity.stage}</span>
          <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black ${view.positionLabel === "EARLY" ? "border-green-400/20 bg-green-500/[0.06] text-green-400" : "border-zinc-700 text-zinc-600"}`}>
            {view.positionLabel}
          </span>
          {catalyst && <span className="rounded-full border border-orange-400/25 bg-orange-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-orange-300">⚡ {catalyst}</span>}
          {opportunity.riskTags.map((tag) => (
            <span key={tag} className="rounded-full border border-red-400/25 bg-red-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-red-300">
              ⚠ {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="border-b border-white/8 px-5 py-4">
        <p className="text-sm font-bold leading-5 text-zinc-200">{opportunity.whyItMatters}</p>
      </div>

      {framework && <OpportunityWindow framework={framework} compact />}

      {opportunity.signals.length > 0 && (
        <div className="border-b border-white/8 px-5 py-3">
          <p className="mb-2 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700">Evidence</p>
          <div className="space-y-1.5">
            {opportunity.signals.slice(0, 4).map((signal, index) => (
              <div key={`${signal}-${index}`} className="flex gap-2">
                <span className="shrink-0 text-[10px] font-black text-violet-400/60">▸</span>
                <p className="text-[11px] font-semibold leading-4 text-zinc-500">{signal}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-b border-white/8 px-5 py-3">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[7px] font-black uppercase tracking-[0.18em] text-zinc-700">Opportunity Score</p>
            <p className="font-mono text-2xl font-black leading-none text-violet-400">{Math.round(opportunity.opportunityScore)}</p>
          </div>
          <p className="text-[10px] font-black text-violet-400">{view.confidenceLabel} CONFIDENCE</p>
        </div>
        <OpportunityMetrics opportunity={opportunity} />
      </div>

      {narrative && (
        <div className="border-b border-white/8 px-5 py-3">
          <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700">HT Read</p>
          <p className="text-xs font-semibold italic leading-5 text-zinc-500">“{narrative}”</p>
        </div>
      )}

      {trace && (
        <div className="border-b border-white/8 px-5 py-3">
          <DecisionTrace trace={trace} />
        </div>
      )}

      <div className="px-5 py-4">
        <div className="flex gap-2">
          <button onClick={onOpen} className="flex-1 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] py-3 text-xs font-black text-violet-300">Full Signal Breakdown →</button>
          <button onClick={onWatch} className={`rounded-xl border px-4 py-3 text-xs font-black transition ${watched ? "border-violet-400/30 bg-violet-500/10 text-violet-300" : "border-white/8 bg-white/[0.02] text-zinc-600"}`}>
            {watched ? "★" : "☆"}
          </button>
        </div>
        <p className="mt-2.5 text-center text-[8px] font-semibold text-zinc-700">Signals are for research only, not financial advice.</p>
      </div>
    </div>
  );
}
