import type { BullBearAnalysis } from "@/lib/contracts/market";

type BullBearPanelProps = {
  ticker: string;
  data: BullBearAnalysis | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
};

export default function BullBearPanel({
  ticker,
  data,
  loading,
  expanded,
  onToggle,
}: BullBearPanelProps) {
  const current = data?.ticker === ticker ? data : null;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/8 border-t border-white/8">
        <CaseColumn kind="bull" points={current?.bullCase} loading={loading} ticker={ticker} />
        <CaseColumn kind="bear" points={current?.bearCase} loading={loading} ticker={ticker} />
      </div>
      <div className="px-5 py-2.5 border-t border-white/8">
        <button onClick={onToggle} className="w-full flex items-center justify-between group">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Full Intelligence Breakdown
            </span>
            {current && (
              <span className="rounded-full border border-green-400/20 bg-green-500/10 px-2 py-0.5 text-[8px] font-black text-green-400">
                {current.newsCount > 0 ? `${current.newsCount} sources` : "AI Analysis"}
              </span>
            )}
          </div>
          <span className="text-zinc-600 group-hover:text-zinc-300 transition text-sm">
            {expanded ? "▲" : "▼"}
          </span>
        </button>
        {expanded && current && (
          <div className="mt-4 space-y-3 pb-2">
            <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500 mb-1">
                🚨 Why It&apos;s On Our Radar
              </p>
              <p className="text-xs font-semibold text-zinc-200 leading-5">{current.onRadar}</p>
            </div>
            <p className="text-[9px] text-zinc-700 text-center">
              Not financial advice. HT Labs surfaces information — you make the call.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function CaseColumn({
  kind,
  points,
  loading,
  ticker,
}: {
  kind: "bull" | "bear";
  points?: string[];
  loading: boolean;
  ticker: string;
}) {
  const bullish = kind === "bull";
  return (
    <div className={`p-4 ${bullish ? "bg-green-500/[0.02]" : "bg-red-500/[0.02]"}`}>
      <p className={`text-[10px] font-black uppercase tracking-[0.18em] mb-2 ${bullish ? "text-green-400" : "text-red-400"}`}>
        {bullish ? "🐂 Bull Case" : "🐻 Bear Case"}
      </p>
      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className={`h-2.5 rounded w-full ${bullish ? "bg-green-900/40" : "bg-red-900/40"}`} />
          <div className={`h-2.5 rounded w-4/5 ${bullish ? "bg-green-900/40" : "bg-red-900/40"}`} />
          <div className={`h-2.5 rounded w-3/5 ${bullish ? "bg-green-900/40" : "bg-red-900/40"}`} />
        </div>
      ) : points ? (
        <ul className="space-y-2">
          {points.slice(0, 3).map((point, index) => (
            <li key={`${point}-${index}`} className="flex gap-2 text-xs font-semibold text-zinc-300 leading-4">
              <span className={`font-black shrink-0 ${bullish ? "text-green-500" : "text-red-500"}`}>
                {bullish ? "+" : "−"}
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-zinc-600">Analyzing {ticker}...</p>
      )}
    </div>
  );
}
