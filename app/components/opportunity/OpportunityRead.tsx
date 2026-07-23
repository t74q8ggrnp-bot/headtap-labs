import {
  getOpportunityPresentation,
  type Opportunity,
} from "@/lib/opportunity-model";

type OpportunityReadProps = {
  opportunity: Opportunity;
  loading?: boolean;
  narrative?: string | null;
};

export default function OpportunityRead({
  opportunity,
  loading = false,
  narrative,
}: OpportunityReadProps) {
  const view = getOpportunityPresentation(opportunity);
  const details = [
    {
      label: "Price Action",
      value: view.priceActionLabel,
      color:
        view.priceActionLabel === "Positive"
          ? "text-green-400"
          : view.priceActionLabel === "Negative"
            ? "text-orange-400"
            : "text-zinc-500",
    },
    {
      label: "Momentum",
      value: view.momentumLabel,
      color:
        view.momentumLabel === "Strengthening"
          ? "text-green-400"
          : view.momentumLabel === "Stable"
            ? "text-violet-400"
            : "text-zinc-500",
    },
    {
      label: "Crowd",
      value: view.crowdLabel,
      color:
        view.crowdLabel === "Early"
          ? "text-green-400"
          : view.crowdLabel === "Building"
            ? "text-violet-400"
            : "text-red-400",
    },
  ];

  return (
    <div className="flex flex-col">
      <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-700 mb-2">
        HT Labs Read
      </p>
      {loading ? (
        <div className="space-y-1.5 animate-pulse">
          <div className="h-2.5 bg-zinc-900 rounded w-full" />
          <div className="h-2.5 bg-zinc-900 rounded w-3/4" />
        </div>
      ) : (
        <p className="text-sm font-semibold text-zinc-300 leading-5">
          {narrative ? `“${narrative}”` : opportunity.whyItMatters}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5 mt-3">
        {details.map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <p className="text-[7px] font-black uppercase tracking-[0.1em] text-zinc-700 mb-1">{label}</p>
            <p className={`text-[11px] font-black ${color}`}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
