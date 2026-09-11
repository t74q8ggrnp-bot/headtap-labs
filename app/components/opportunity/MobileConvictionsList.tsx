import LiveStockValue from "@/app/components/market/LiveStockValue";
import type { Opportunity } from "@/lib/opportunity-model";

type MobileConvictionsListProps = {
  opportunities: Opportunity[];
  onOpen: (opportunity: Opportunity) => void;
};

export default function MobileConvictionsList({
  opportunities,
  onOpen,
}: MobileConvictionsListProps) {
  return (
    <section className="h-full overflow-y-auto px-4 pb-24 pt-12" aria-labelledby="mobile-convictions-title">
      <h2 id="mobile-convictions-title" className="ht-section-label mb-4">Top convictions</h2>
      {opportunities.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
          <p className="text-sm font-semibold text-zinc-400">No canonical opportunities qualify right now.</p>
        </div>
      ) : (
        <ol className="ht-ranked-list">
          {opportunities.map((opportunity) => (
            <li key={opportunity.ticker}>
              <button onClick={() => onOpen(opportunity)} className="ht-ranked-list__row">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-2xl font-black text-white">{opportunity.ticker}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-400">{opportunity.stage}</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-lg font-black ${opportunity.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                    <LiveStockValue symbol={opportunity.ticker} field="change" fallback={opportunity.change} />
                  </p>
                  <p className="mt-0.5 text-xs font-black text-orange-300">HT {Math.round(opportunity.opportunityScore)}</p>
                </div>
              </div>
              <div className="mt-3 inline-flex rounded-xl border border-orange-400/20 bg-orange-500/[0.06] px-3 py-1.5 text-[10px] font-black text-orange-300">
                {opportunity.whatChanged}
              </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
