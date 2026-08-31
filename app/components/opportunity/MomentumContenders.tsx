import type { Opportunity } from "@/lib/opportunity-model";

type MomentumContendersProps = {
  candidates: Opportunity[];
  radarCandidates?: Opportunity[];
  onSelect: (opportunity: Opportunity) => void;
};

export default function MomentumContenders({
  candidates,
  radarCandidates = [],
  onSelect,
}: MomentumContendersProps) {
  return (
    <div className="flex h-full min-h-full flex-col bg-white/[0.01] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-700">
          Overall Contenders
        </p>
        {candidates.length > 0 && (
          <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-zinc-800">
            Live canonical rank
          </p>
        )}
      </div>
      {candidates.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/[0.06] p-6">
          <p className="text-center text-xs font-semibold text-zinc-700">
            No other qualifying setups right now.
          </p>
        </div>
      ) : (
        <div className="ht-momentum-contender-rows grid flex-1 auto-rows-fr content-stretch gap-2">
          {candidates.map((opportunity, index) => (
              <button
                key={opportunity.ticker}
                onClick={() => onSelect(opportunity)}
                className="flex h-full min-h-[5.5rem] items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-4 py-3 text-left transition hover:border-violet-400/25 hover:bg-violet-500/[0.04]"
              >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[9px] font-black text-zinc-800 shrink-0">#{index + 2}</span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-white truncate">{opportunity.ticker}</span>
                    <span className={`font-mono text-[10px] font-black shrink-0 ${opportunity.change >= 0 ? "text-orange-400" : "text-red-400"}`}>
                      {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {opportunity.riskTags[0] && (
                      <span className="w-fit rounded-full border border-red-400/25 bg-red-500/[0.06] px-2 py-0.5 text-[8px] font-black text-red-300">
                        ⚠ {opportunity.riskTags[0]}
                      </span>
                    )}
                    <span className="text-[8px] font-bold text-zinc-700">
                      {opportunity.relativeVolume.toFixed(1)}× vol
                    </span>
                    <span className="text-[8px] font-bold text-zinc-700">
                      {opportunity.stage}
                    </span>
                    {opportunity.momentumRadarEligible && (
                      <span className="w-fit rounded-full border border-amber-400/25 bg-amber-500/[0.07] px-2 py-0.5 text-[8px] font-black text-amber-300">
                        Radar · entry withheld
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-lg font-black text-white">{Math.round(opportunity.opportunityScore)}</p>
                <p className="text-[7px] font-black uppercase tracking-[0.14em] text-orange-400">HT Score</p>
              </div>
              </button>
          ))}
        </div>
      )}
      {radarCandidates.length > 0 && (
        <MomentumRadar
          candidates={radarCandidates}
          onSelect={onSelect}
          embedded
        />
      )}
    </div>
  );
}

export function MomentumRadar({
  candidates,
  onSelect,
  embedded = false,
}: {
  candidates: Opportunity[];
  onSelect: (opportunity: Opportunity) => void;
  embedded?: boolean;
}) {
  if (candidates.length === 0) return null;

  return (
    <div
      className={
        embedded
          ? "mt-4 border-t border-amber-400/10 pt-4"
          : "border-t border-amber-400/10 bg-amber-500/[0.012] px-5 py-4"
      }
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className="text-[8px] font-black uppercase tracking-[0.22em] text-amber-300/70">
          Momentum Radar · Entry Withheld
        </p>
        <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-zinc-800">
          Observation only
        </p>
      </div>
      <div
        className={`grid grid-cols-1 gap-2 ${embedded ? "" : "sm:grid-cols-2 xl:grid-cols-5"}`}
      >
        {candidates.map((opportunity) => (
          <button
            key={`radar-${opportunity.ticker}`}
            onClick={() => onSelect(opportunity)}
            className="flex min-h-[4.5rem] items-center justify-between gap-3 rounded-xl border border-amber-400/10 bg-black/25 px-4 py-3 text-left transition hover:border-amber-400/25 hover:bg-amber-500/[0.035]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm font-black text-white">
                  {opportunity.ticker}
                </span>
                <span className="shrink-0 font-mono text-[10px] font-black text-amber-300">
                  {opportunity.change >= 0 ? "+" : ""}
                  {opportunity.change.toFixed(1)}%
                </span>
              </div>
              <p className="mt-1 text-[8px] font-bold text-zinc-600">
                {opportunity.relativeVolume.toFixed(1)}× vol · No qualifying entry
              </p>
            </div>
            <p className="shrink-0 text-[8px] font-black uppercase tracking-[0.12em] text-amber-300/70">
              Radar
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
