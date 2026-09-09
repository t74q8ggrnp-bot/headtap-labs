export default function TradeWorkspaceLoading() {
  return (
    <main className="min-h-screen w-full overflow-x-clip bg-[#050607] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pl-[calc(env(safe-area-inset-left,0px)+0.5rem)] pr-[calc(env(safe-area-inset-right,0px)+0.5rem)] pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] text-white sm:pl-[calc(env(safe-area-inset-left,0px)+0.75rem)] sm:pr-[calc(env(safe-area-inset-right,0px)+0.75rem)] sm:pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] md:pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] md:pl-[calc(env(safe-area-inset-left,0px)+1.25rem)] md:pr-[calc(env(safe-area-inset-right,0px)+1.25rem)] md:pt-[calc(env(safe-area-inset-top,0px)+1.25rem)]">
      <div className="mx-auto max-w-[1720px] animate-pulse overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#080b0d] shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:rounded-[26px]">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-2.5 py-2 sm:gap-4 sm:px-4 sm:py-4 md:px-6">
          <div className="h-7 w-16 rounded-lg bg-white/[0.06] sm:h-8 sm:w-20" />
          <div className="h-11 min-w-0 flex-1 rounded-xl bg-white/[0.05]" />
          <div className="hidden h-10 w-28 rounded-xl bg-white/[0.05] sm:block" />
        </div>
        <div className="border-b border-white/[0.07] px-3 py-2.5 sm:px-4 sm:py-4 md:px-6 md:py-5">
          <div className="h-7 w-44 rounded-xl bg-white/[0.07] sm:h-10 sm:w-64" />
          <div className="mt-2 h-3 w-64 max-w-full rounded-full bg-white/[0.04]" />
        </div>
        <div className="border-b border-white/[0.06] px-3 py-2 2xl:hidden">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.07] bg-black/35 p-1">
            <div className="h-11 rounded-lg bg-white/[0.06]" />
            <div className="h-11 rounded-lg bg-white/[0.08]" />
            <div className="h-11 rounded-lg bg-white/[0.06]" />
          </div>
        </div>
        <div className="grid min-w-0 2xl:min-h-[650px] 2xl:grid-cols-[250px_minmax(0,1fr)_360px]">
          <div className="hidden border-r border-white/[0.07] p-4 2xl:block">
            <div className="h-72 rounded-2xl bg-white/[0.035]" />
          </div>
          <div className="min-w-0 p-2 sm:p-3 md:p-4 2xl:p-5">
            <div className="h-[clamp(340px,calc(100dvh-290px),620px)] rounded-2xl border border-white/[0.06] bg-white/[0.025] md:h-[clamp(500px,calc(100dvh-300px),720px)]" />
          </div>
          <div className="hidden border-l border-white/[0.07] p-4 2xl:block">
            <div className="h-80 rounded-2xl bg-white/[0.035]" />
          </div>
        </div>
      </div>
    </main>
  );
}
