import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";

export default function OpportunityMetrics({ opportunity }: { opportunity: Opportunity }) {
  const view = getOpportunityPresentation(opportunity);
  const metrics = [
    { label: "Breakout", value: `${opportunity.breakoutPotentialScore}`, color: opportunity.breakoutPotentialScore >= 82 ? "text-green-400" : opportunity.breakoutPotentialScore >= 68 ? "text-orange-400" : "text-zinc-500" },
    { label: "Window Open", value: `${view.windowOpen}%`, color: "text-violet-400" },
    { label: "Saturated", value: `${view.saturation}%`, color: "text-orange-400" },
    { label: "Confidence", value: view.confidenceLabel, color: view.confidenceLabel === "HIGH" ? "text-violet-400" : view.confidenceLabel === "MEDIUM" ? "text-orange-400" : "text-zinc-500" },
    { label: "Risk", value: view.riskLabel, color: view.riskLabel === "HIGH" ? "text-red-400" : view.riskLabel === "MEDIUM" ? "text-orange-400" : "text-green-400" },
    { label: "Position", value: view.positionLabel, color: "text-violet-400" },
  ];

  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
      {metrics.map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border border-white/5 bg-black/30 px-1.5 py-2 text-center">
          <p className={`font-mono text-[11px] font-black leading-none ${color}`}>{value}</p>
          <p className="text-[6px] font-black uppercase tracking-[0.05em] text-zinc-700 mt-1.5">{label}</p>
        </div>
      ))}
    </div>
  );
}
