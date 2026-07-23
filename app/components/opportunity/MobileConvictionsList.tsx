import type { Opportunity } from "@/lib/opportunity-model";

type MobileConvictionsListProps = {
  opportunities: Opportunity[];
  onOpen: (opportunity: Opportunity) => void;
};

export default function MobileConvictionsList({ opportunities, onOpen }: MobileConvictionsListProps) {
  const ranked = [...opportunities].sort((a, b) => b.opportunityScore - a.opportunityScore);

  return (
    <div className="h-full overflow-y-auto px-4 pb-24 pt-12">
      <p className="mb-4 text-[11px] font-black uppercase tracking-[0.24em] text-orange-300">Top Convictions</p>
      {ranked.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
          <p className="text-sm font-semibold text-zinc-400">No canonical opportunities qualify right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ranked.map((opportunity) => (
            <button key={opportunity.ticker} onClick={() => onOpen(opportunity)} className="w-full rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-2xl font-black text-white">{opportunity.ticker}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-400">{opportunity.stage}</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-lg font-black ${opportunity.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {opportunity.change >= 0 ? "+" : ""}{opportunity.change.toFixed(2)}%
                  </p>
                  <p className="mt-0.5 text-xs font-black text-orange-300">HT {Math.round(opportunity.opportunityScore)}</p>
                </div>
              </div>
              <div className="mt-3 inline-flex rounded-xl border border-orange-400/20 bg-orange-500/[0.06] px-3 py-1.5 text-[10px] font-black text-orange-300">
                {opportunity.whatChanged}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
