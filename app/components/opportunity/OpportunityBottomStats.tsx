import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";

export default function OpportunityBottomStats({ opportunity }: { opportunity: Opportunity }) {
  const view = getOpportunityPresentation(opportunity);
  const stats = [
    { icon: "🔥", label: "Market Mood", value: opportunity.change >= 0 ? "Risk On" : "Risk Off", tone: "text-white" },
    { icon: "👥", label: "Retail Attention", value: view.saturation < 40 ? "Rising" : view.saturation < 65 ? "Building" : "Peaked", tone: "text-white" },
    { icon: "📊", label: "Volume", value: `${opportunity.relativeVolume.toFixed(1)}x avg`, tone: "text-white" },
    { icon: "🎯", label: "Opportunity", value: view.positionLabel === "VERIFIED" ? "Verified" : view.positionLabel === "EARLY" ? "Early" : view.positionLabel === "BUILDING" ? "Developing" : "Late", tone: "text-violet-400" },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/8 border-t border-white/8">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-center gap-2.5 p-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-sm shrink-0">{stat.icon}</span>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">{stat.label}</p>
            <p className={`text-sm font-black ${stat.tone}`}>{stat.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
