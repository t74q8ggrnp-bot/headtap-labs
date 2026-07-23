import type { TradeFrameworkDisplay } from "@/lib/contracts/market";

type OpportunityWindowProps = {
  framework: TradeFrameworkDisplay;
  compact?: boolean;
};

export default function OpportunityWindow({
  framework,
  compact = false,
}: OpportunityWindowProps) {
  const confidenceTone =
    framework.confidence === "High"
      ? "border-green-400/25 text-green-400"
      : framework.confidence === "Moderate"
        ? "border-violet-400/20 text-violet-400"
        : "border-zinc-800 text-zinc-600";

  if (compact) {
    return (
      <div className="px-5 py-4 border-b border-white/8">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-400">
            Opportunity Window
          </p>
          <div className="flex items-center gap-1.5">
            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${confidenceTone}`}>
              {framework.confidence}
            </span>
            <span className="text-[8px] font-semibold text-zinc-600">{framework.horizon}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Value label="Upside" value={`+${framework.uptideMin}%`} detail={`→ +${framework.uptideMax}%`} tone="text-green-400" />
          <Value label="Risk" value={`-${framework.riskZone}%`} tone="text-red-400" />
          <Value label="R/R" value={`${framework.rr}:1`} tone="text-violet-400" />
        </div>
        <p className="text-[10px] font-semibold text-zinc-600 italic leading-4">{framework.sentence}</p>
        {!framework.isLive && <p className="text-[8px] text-zinc-700 mt-1">Based on last session</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-black/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/6">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-400">
          Opportunity Window
        </p>
        <div className="flex items-center gap-2">
          <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${confidenceTone}`}>
            {framework.confidence}
          </span>
          <span className="text-[8px] font-semibold text-zinc-700">{framework.horizon}</span>
          {!framework.isLive && <span className="text-[8px] text-zinc-800">· Last session</span>}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/6">
        <Value label="Upside" value={`+${framework.uptideMin}%`} detail={`to +${framework.uptideMax}%`} tone="text-green-400" large />
        <Value label="Risk" value={`-${framework.riskZone}%`} tone="text-red-400" large />
        <Value label="R/R Ratio" value={`${framework.rr}:1`} tone="text-violet-400" large />
      </div>
      <div className="px-4 py-2.5 border-t border-white/6 bg-white/[0.01]">
        <p className="text-[10px] font-semibold text-zinc-600 italic">{framework.sentence}</p>
      </div>
    </div>
  );
}

function Value({
  label,
  value,
  detail,
  tone,
  large = false,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: string;
  large?: boolean;
}) {
  return (
    <div className={large ? "px-4 py-4" : ""}>
      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-600 mb-2">{label}</p>
      <p className={`font-mono font-black leading-none ${tone} ${large ? "text-[2.4rem]" : "text-lg"}`}>{value}</p>
      {detail && <p className={`font-mono text-xs font-black mt-1.5 ${tone} opacity-40`}>{detail}</p>}
    </div>
  );
}
