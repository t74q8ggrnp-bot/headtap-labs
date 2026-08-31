import type {
  DecisionTraceDisplay,
} from "@/lib/contracts/market";
import {
  getOpportunityPresentation,
  type Opportunity,
} from "@/lib/opportunity-model";
import DecisionTrace from "./DecisionTrace";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityRead from "./OpportunityRead";
import ProxPulse from "./ProxPulse";

type OpportunityScorePanelProps = {
  opportunity: Opportunity;
  dualEngine: boolean;
  trace: DecisionTraceDisplay | null;
  narrative: string | null;
  narrativeLoading: boolean;
};

export default function OpportunityScorePanel({
  opportunity,
  dualEngine,
  trace,
  narrative,
  narrativeLoading,
}: OpportunityScorePanelProps) {
  const score = opportunity.opportunityScore;
  const view = getOpportunityPresentation(opportunity);
  const explosion = opportunity.explosionAssessment;
  const catalyst = opportunity.catalystTags[0] ?? null;
  const catalystPlay = opportunity.catalystScore >= 20 || Boolean(catalyst);
  const selectionLabel =
    opportunity.freshnessLabel === "Last Verified Signal"
      ? "Last Trading Session"
      : catalystPlay
        ? catalyst ?? "Catalyst Watch"
        : opportunity.change >= 3
          ? "Momentum Leader"
          : opportunity.stage;
  const crowdBadge =
    view.positionLabel === "VERIFIED"
      ? "Last Verified"
      : view.positionLabel === "EARLY"
        ? "Pre-Crowd"
        : view.positionLabel === "BUILDING"
          ? "Crowd Building"
          : "Crowd Arrived";

  return (
    <div className="flex h-full flex-col justify-between gap-3 p-5">
      <div>
        <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-700 mb-2">Opportunity Score</p>
        <div className="flex items-end gap-3">
          <p className={`font-mono text-[3rem] font-black leading-none ${score >= 80 ? "text-green-400" : score >= 65 ? "text-violet-400" : "text-orange-400"}`}>
            {score}
          </p>
          <div className="pb-0.5">
            <p className="text-sm font-black text-white leading-tight">{opportunity.whatChanged}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
        <p className="mb-2 text-[8px] font-black uppercase tracking-[0.18em] text-zinc-700">
          Setup Status
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[9px] font-black text-zinc-500">
            {selectionLabel}
          </span>
          <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black ${view.positionLabel === "EARLY" ? "border-green-400/20 text-green-500" : "border-zinc-800 text-zinc-600"}`}>
            {crowdBadge}
          </span>
          {explosion && (
            <span className="rounded-full border border-orange-400/20 bg-orange-500/[0.05] px-2.5 py-0.5 text-[9px] font-black text-orange-300">
              {explosion.label} · {explosion.score}/100
            </span>
          )}
          {catalystPlay && catalyst && (
            <span className="rounded-full border border-orange-400/25 bg-orange-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-orange-300">
              ⚡ {catalyst}
            </span>
          )}
          {dualEngine && (
            <span className="rounded-full border border-amber-400/20 bg-amber-500/[0.05] px-2.5 py-0.5 text-[9px] font-black text-amber-400">
              ⚡ Dual Engine
            </span>
          )}
          {opportunity.riskTags.map((tag) => (
            <span key={tag} className="rounded-full border border-red-400/20 bg-red-500/[0.05] px-2.5 py-0.5 text-[8px] font-black text-red-300">
              ⚠ {tag}
            </span>
          ))}
        </div>
      </div>

      {opportunity.proxIntelligence &&
        opportunity.proxIntelligence.status !== "unavailable" && (
          <ProxPulse packet={opportunity.proxIntelligence} />
        )}
      <OpportunityMetrics opportunity={opportunity} />
      <OpportunityRead opportunity={opportunity} loading={narrativeLoading} narrative={narrative} />
      {trace && <DecisionTrace trace={trace} />}
    </div>
  );
}
