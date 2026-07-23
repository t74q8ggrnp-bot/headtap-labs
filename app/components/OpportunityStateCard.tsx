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
        className={`${compact ? "mx-4 mt-4 mb-3 rounded-2xl p-6" : "rounded-[1.65rem] p-8"} border border-white/10 bg-black/40 text-center animate-pulse`}
      >
        <div className="mx-auto mb-5 h-2 w-36 rounded-full bg-white/10" />
        <div className="mx-auto mb-3 h-8 w-64 max-w-full rounded-lg bg-white/10" />
        <div className="mx-auto h-4 w-80 max-w-full rounded bg-white/5" />
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-600">
          Loading latest verified signal
        </p>
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
