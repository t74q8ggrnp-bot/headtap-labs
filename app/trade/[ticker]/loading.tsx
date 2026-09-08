export default function TradeWorkspaceLoading() {
  return (
    <main className="min-h-screen bg-[#050607] px-3 pb-24 pt-3 text-white md:px-5 md:pb-8 md:pt-5">
      <div className="mx-auto max-w-[1720px] animate-pulse overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#080b0d] shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-4 border-b border-white/[0.07] px-4 py-4 md:px-6">
          <div className="h-8 w-20 rounded-lg bg-white/[0.06]" />
          <div className="h-11 min-w-0 flex-1 rounded-xl bg-white/[0.05]" />
          <div className="hidden h-10 w-28 rounded-xl bg-white/[0.05] sm:block" />
        </div>
        <div className="border-b border-white/[0.07] px-4 py-5 md:px-6">
          <div className="h-3 w-32 rounded-full bg-white/[0.05]" />
          <div className="mt-3 h-11 w-64 rounded-xl bg-white/[0.07]" />
          <div className="mt-3 h-3 w-72 max-w-full rounded-full bg-white/[0.04]" />
        </div>
        <div className="grid min-h-[620px] lg:grid-cols-[240px_minmax(0,1fr)_340px]">
          <div className="hidden border-r border-white/[0.07] p-4 lg:block">
            <div className="h-72 rounded-2xl bg-white/[0.035]" />
          </div>
          <div className="p-3 md:p-5">
            <div className="h-[420px] rounded-2xl border border-white/[0.06] bg-white/[0.025] md:h-[560px]" />
          </div>
          <div className="hidden border-l border-white/[0.07] p-4 lg:block">
            <div className="h-80 rounded-2xl bg-white/[0.035]" />
          </div>
        </div>
      </div>
    </main>
  );
}
