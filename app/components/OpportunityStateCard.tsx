type OpportunityStateCardProps = {
  loading: boolean;
  compact?: boolean;
};

export default function OpportunityStateCard({
  loading,
  compact = false,
}: OpportunityStateCardProps) {
  if (loading) {
    return (
      <div
        className={`${compact ? "mx-4 mt-4 mb-3 rounded-2xl px-5 py-4" : "rounded-[1.65rem] px-6 py-5"} border border-white/10 bg-black/40`}
      >
        <div className="flex items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.7)]" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">
                Syncing verified market data
              </p>
              <p className="mt-1 truncate text-xs font-semibold text-zinc-600">
                Canonical decisions will appear when the backend responds.
              </p>
            </div>
          </div>
          <div className="hidden shrink-0 animate-pulse items-center gap-1.5 sm:flex">
            <span className="h-1.5 w-8 rounded-full bg-white/10" />
            <span className="h-1.5 w-8 rounded-full bg-white/10" />
            <span className="h-1.5 w-8 rounded-full bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${compact ? "mx-4 mt-4 mb-3 rounded-2xl p-6 text-left" : "rounded-[1.65rem] p-8 text-center"} border border-white/10 bg-black/40`}
    >
      <div className={`flex items-center gap-2 mb-4 ${compact ? "" : "justify-center"}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-600">
          Top Opportunity
        </p>
      </div>
      <p className="text-2xl font-black text-white mb-1.5">No Signal Confirmed</p>
      <p className="text-sm font-semibold text-zinc-500">
        No stock currently clears the canonical HT Labs qualification gate.
        Monitoring continues.
      </p>
    </div>
  );
}
