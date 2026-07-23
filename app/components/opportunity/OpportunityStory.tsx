import OpportunityWindow from "./OpportunityWindow";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";
import type { TradeFrameworkDisplay } from "@/lib/contracts/market";

type OpportunityStoryProps = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  dualEngine: boolean;
  watched: boolean;
  onOpen: () => void;
  onWatch: () => void;
};

export default function OpportunityStory({
  opportunity,
  framework,
  dualEngine,
  watched,
  onOpen,
  onWatch,
}: OpportunityStoryProps) {
  const view = getOpportunityPresentation(opportunity);
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
    <div className="p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-baseline gap-3 flex-wrap mb-2">
          <p className="font-mono text-[3.6rem] font-black uppercase leading-none tracking-[-0.08em] text-white">
            {opportunity.ticker}
          </p>
          <div className="flex items-center gap-2 pb-1">
            <span className="font-mono text-xl font-black text-white">${opportunity.price.toFixed(2)}</span>
            <span className={`font-mono text-sm font-black ${opportunity.change >= 0 ? "text-green-400" : "text-red-400"}`}>
              {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-black text-zinc-500">
            {selectionLabel}
          </span>
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black ${view.positionLabel === "EARLY" ? "border-green-400/20 text-green-500" : "border-zinc-800 text-zinc-600"}`}>
            {crowdBadge}
          </span>
          {catalystPlay && catalyst && (
            <span className="rounded-full border border-orange-400/30 bg-orange-500/[0.07] px-2.5 py-0.5 text-[10px] font-black text-orange-300">
              ⚡ {catalyst}
            </span>
          )}
          {dualEngine && (
            <span className="rounded-full border border-amber-400/20 bg-amber-500/[0.05] px-2.5 py-0.5 text-[10px] font-black text-amber-400">
              ⚡ Dual Engine Confirmation
            </span>
          )}
        </div>
        {opportunity.riskTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            {opportunity.riskTags.map((tag) => (
              <span key={tag} className="rounded-full border border-red-400/25 bg-red-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-red-300">
                ⚠ {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm font-semibold text-zinc-400 leading-5">{opportunity.whyItMatters}</p>
      {framework && <OpportunityWindow framework={framework} />}

      {opportunity.signals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {opportunity.signals.slice(0, 4).map((signal, index) => (
            <div key={`${signal}-${index}`} className="flex gap-2">
              <span className="text-violet-400/40 text-xs shrink-0 mt-0.5">▸</span>
              <p className="text-[11px] font-semibold text-zinc-600 leading-4">{signal}</p>
            </div>
          ))}
        </div>
      )}

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
