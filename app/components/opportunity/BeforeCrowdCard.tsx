import type { DecisionTraceDisplay, TradeFrameworkDisplay } from "@/lib/contracts/market";
import type { Opportunity } from "@/lib/opportunity-model";
import OpportunityBottomStats from "./OpportunityBottomStats";
import OpportunityScorePanel from "./OpportunityScorePanel";
import OpportunityStory from "./OpportunityStory";

type BeforeCrowdCardProps = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  trace: DecisionTraceDisplay | null;
  dualEngine: boolean;
  watched: boolean;
  updatedLabel: string;
  onOpen: () => void;
  onWatch: () => void;
};

export default function BeforeCrowdCard({
  opportunity,
  framework,
  trace,
  dualEngine,
  watched,
  updatedLabel,
  onOpen,
  onWatch,
}: BeforeCrowdCardProps) {
  const isCatalyst = opportunity.catalystScore >= 20 || opportunity.catalystTags.length > 0;

  return (
    <div className="overflow-hidden rounded-[1.65rem] border border-orange-400/20 bg-gradient-to-br from-black via-black to-orange-500/[0.03]">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 animate-pulse rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.9)]" />
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-orange-400">Before The Crowd</p>
        </div>
        <div className="flex items-center gap-2">
          {dualEngine && (
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[9px] font-black text-amber-400">
              ⚡ Dual Engine Confirmation
            </span>
          )}
          <span className="text-[10px] font-black text-zinc-600">{updatedLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-white/[0.06] lg:grid-cols-[1.15fr_0.85fr] lg:divide-x lg:divide-y-0">
        <OpportunityStory
          opportunity={opportunity}
          framework={framework}
          dualEngine={dualEngine}
          watched={watched}
          onOpen={onOpen}
          onWatch={onWatch}
        />
        <OpportunityScorePanel
          opportunity={opportunity}
          trace={trace}
          narrative={opportunity.whyItMatters}
          narrativeLoading={false}
        />
      </div>

      <OpportunityBottomStats opportunity={opportunity} />

      <div className="flex items-center justify-between border-t border-white/8 bg-orange-500/[0.03] px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-orange-400">⚡</span>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">
            {isCatalyst ? "Catalyst Signal" : "Early Signal"} — Before The Crowd
          </p>
        </div>
        <p className="font-mono text-lg font-black text-orange-400">{Math.round(opportunity.opportunityScore)}</p>
      </div>
    </div>
  );
}
