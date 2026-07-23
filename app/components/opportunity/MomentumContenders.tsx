import type { Opportunity } from "@/lib/opportunity-model";

type MomentumContendersProps = {
  candidates: Opportunity[];
  onSelect: (opportunity: Opportunity) => void;
};

export default function MomentumContenders({ candidates, onSelect }: MomentumContendersProps) {
  return (
    <div className="flex flex-col p-5 bg-white/[0.01]">
      <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-700 mb-3">
        Other Contenders
      </p>
      {candidates.length === 0 ? (
        <p className="text-xs font-semibold text-zinc-700">
          No other qualifying setups right now.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map((opportunity, index) => (
            <button
              key={opportunity.ticker}
              onClick={() => onSelect(opportunity)}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-left transition hover:border-violet-400/25 hover:bg-violet-500/[0.04]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[9px] font-black text-zinc-800 shrink-0">#{index + 2}</span>
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-white truncate">{opportunity.ticker}</span>
                    <span className={`font-mono text-[10px] font-black shrink-0 ${opportunity.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(1)}%
                    </span>
                  </div>
                  {opportunity.riskTags[0] && (
                    <span className="w-fit rounded-full border border-red-400/25 bg-red-500/[0.06] px-2 py-0.5 text-[8px] font-black text-red-300">
                      ⚠ {opportunity.riskTags[0]}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-lg font-black text-violet-400">{Math.round(opportunity.opportunityScore)}</p>
                <p className="text-[7px] font-black uppercase tracking-[0.14em] text-zinc-700">{opportunity.tier}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
