import type { DecisionTraceDisplay } from "@/lib/contracts/market";

export default function DecisionTrace({ trace }: { trace: DecisionTraceDisplay }) {
  if (trace.primaryDrivers.length === 0) return null;
  const confidenceTone =
    trace.confidence === "High"
      ? "border-green-400/20 text-green-500"
      : trace.confidence === "Moderate"
        ? "border-violet-400/15 text-violet-500"
        : "border-zinc-800 text-zinc-700";

  return (
    <div className="rounded-xl border border-white/[0.05] bg-black/40 overflow-hidden mt-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700">Decision Trace</p>
        <div className="flex items-center gap-2">
          <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-full border ${confidenceTone}`}>
            {trace.confidence}
          </span>
          <span className="text-[7px] font-semibold text-zinc-800">
            Opp {trace.opportunityScore} · {trace.candidatesEvaluated} evaluated
          </span>
        </div>
      </div>
      <div className="px-3 py-2.5 space-y-1.5">
        <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1">Why This Stock</p>
        {trace.primaryDrivers.map((driver, index) => (
          <div key={`${driver}-${index}`} className="flex gap-1.5 items-start">
            <span className="text-violet-400/30 text-[8px] shrink-0 mt-0.5">▸</span>
            <p className="text-[9px] font-semibold text-zinc-600 leading-[1.3]">{driver}</p>
          </div>
        ))}
      </div>
      {trace.rejectedAlternatives.length > 0 && (
        <div className="px-3 pb-2.5 border-t border-white/[0.04] pt-2">
          <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1.5">Why Not Others</p>
          <div className="space-y-1.5">
            {trace.rejectedAlternatives.map((alternative, index) => (
              <div key={`${alternative.symbol}-${index}`} className="flex gap-1.5 items-start">
                <span className="font-mono text-[9px] font-black text-zinc-500 shrink-0">{alternative.symbol}</span>
                <p className="text-[8px] font-semibold text-zinc-700 leading-[1.3]">— {alternative.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
