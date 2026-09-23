type OpportunityStateCardProps = {
  loading: boolean;
  compact?: boolean;
  workspace?: boolean;
};

export default function OpportunityStateCard({
  loading,
  compact = false,
  workspace = false,
}: OpportunityStateCardProps) {
  if (loading) {
    if (workspace) {
      return (
        <section
          className="ht-desktop-spot-workspace__hero ht-home-workspace-loading"
          aria-label="Loading verified market workspace"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="ht-desktop-spot-workspace__summary">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">
                  Syncing verified market data
                </p>
                <p className="mt-1 text-xs font-semibold text-zinc-600">
                  Loading the current Canonical decision.
                </p>
              </div>
            </div>
            <div className="mt-10 space-y-5" aria-hidden="true">
              <span className="block h-14 w-3/5 animate-pulse rounded bg-white/[0.055]" />
              <span className="block h-5 w-2/5 animate-pulse rounded bg-white/[0.04]" />
              <div className="grid grid-cols-2 gap-4 border-y border-white/[0.06] py-5">
                <span className="h-12 animate-pulse rounded bg-white/[0.035]" />
                <span className="h-12 animate-pulse rounded bg-white/[0.035]" />
              </div>
              <span className="block h-24 animate-pulse rounded bg-white/[0.025]" />
            </div>
          </div>
          <div className="ht-desktop-spot-workspace__chart ht-home-workspace-loading__chart" aria-hidden="true">
            <div className="h-16 border-b border-white/[0.05]" />
            <div className="ht-home-workspace-loading__plot">
              <span className="ht-home-workspace-loading__trace" />
            </div>
          </div>
        </section>
      );
    }

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
