import type { DecisionTraceDisplay } from "@/lib/contracts/market";
import type { Opportunity } from "@/lib/opportunity-model";
import DecisionTrace from "./DecisionTrace";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityRead from "./OpportunityRead";

type OpportunityScorePanelProps = {
  opportunity: Opportunity;
  trace: DecisionTraceDisplay | null;
  narrative: string | null;
  narrativeLoading: boolean;
};

export default function OpportunityScorePanel({
  opportunity,
  trace,
  narrative,
  narrativeLoading,
}: OpportunityScorePanelProps) {
  const score = opportunity.opportunityScore;
  return (
    <div className="p-5 flex flex-col gap-4">
      <div>
        <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-700 mb-2">Opportunity Score</p>
        <div className="flex items-end gap-3">
          <p className={`font-mono text-[3rem] font-black leading-none ${score >= 80 ? "text-green-400" : score >= 65 ? "text-violet-400" : "text-orange-400"}`}>
            {score}
          </p>
          <div className="pb-0.5">
            <p className="text-sm font-black text-white leading-tight">{opportunity.stage}</p>
            <p className="text-[10px] font-semibold text-zinc-600 mt-0.5">{opportunity.whatChanged}</p>
          </div>
        </div>
      </div>
      <OpportunityMetrics opportunity={opportunity} />
      <OpportunityRead opportunity={opportunity} loading={narrativeLoading} narrative={narrative} />
      {trace && <DecisionTrace trace={trace} />}
    </div>
  );
}
