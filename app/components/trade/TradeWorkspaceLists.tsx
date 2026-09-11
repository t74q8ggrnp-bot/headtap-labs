"use client";

import Link from "next/link";

function SymbolRow({
  symbol,
  active,
  label,
  onRemove,
}: {
  symbol: string;
  active: boolean;
  label?: string;
  onRemove?: () => void;
}) {
  return (
    <div className={`ht-workspace-list-row group flex items-center gap-2 rounded-xl border ${active ? "border-orange-400/20 bg-orange-500/[0.075]" : "border-transparent"}`}>
      <Link href={`/trade/${encodeURIComponent(symbol)}`} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2.5">
        <span className={`flex h-7 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-[9px] font-black ${active ? "border-orange-400/20 bg-orange-500/10 text-orange-200" : "border-white/[0.065] bg-black/35 text-zinc-400"}`}>
          {symbol.slice(0, 5)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-mono text-[10px] font-black ${active ? "text-white" : "text-zinc-300"}`}>{symbol}</span>
          {label && <span className="mt-0.5 block truncate text-[7px] font-bold uppercase tracking-[0.12em] text-zinc-700">{label}</span>}
        </span>
        <svg aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${active ? "text-orange-400" : "text-zinc-800"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${symbol} from watchlist`}
          className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-600 transition hover:bg-white/[0.05] hover:text-zinc-300 md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
        >
          <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

function EmptyList({ children }: { children: React.ReactNode }) {
  return (
    <div className="ht-workspace-empty rounded-xl border border-dashed px-3 py-4 text-center text-[9px] font-semibold leading-relaxed">
      {children}
    </div>
  );
}

export default function TradeWorkspaceLists({
  currentSymbol,
  watchlist,
  recents,
  watchlistSyncState,
  watchlistCloudEnabled,
  onRemoveWatchlist,
}: {
  currentSymbol: string;
  watchlist: string[];
  recents: string[];
  watchlistSyncState: string;
  watchlistCloudEnabled: boolean;
  onRemoveWatchlist: (symbol: string) => void;
}) {
  return (
    <aside className="ht-workspace-lists space-y-5" aria-label="Workspace lists">
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-600">Quick markets</h2>
          <span className="text-[7px] font-bold uppercase tracking-[0.11em] text-zinc-700">ETF</span>
        </div>
        <div className="space-y-0.5">
          <SymbolRow symbol="SPY" active={currentSymbol === "SPY"} label="S&P 500" />
          <SymbolRow symbol="QQQ" active={currentSymbol === "QQQ"} label="Nasdaq 100" />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-600">Watchlist</h2>
          <span className={`inline-flex items-center gap-1 text-[7px] font-bold uppercase tracking-[0.1em] ${watchlistSyncState === "error" ? "text-red-400" : watchlistSyncState === "syncing" ? "text-orange-400" : "text-zinc-700"}`}>
            <span className={`h-1 w-1 rounded-full ${watchlistSyncState === "error" ? "bg-red-400" : watchlistSyncState === "syncing" ? "animate-pulse bg-orange-400" : "bg-zinc-700"}`} />
            {watchlistCloudEnabled ? (watchlistSyncState === "syncing" ? "Syncing" : watchlistSyncState === "error" ? "Local fallback" : "Synced") : "On device"}
          </span>
        </div>
        {watchlist.length === 0 ? (
          <EmptyList>Tap Watch on a stock or ETF to keep it here.</EmptyList>
        ) : (
          <div className="max-h-[260px] space-y-0.5 overflow-y-auto pr-0.5">
            {watchlist.map((symbol) => (
              <SymbolRow
                key={symbol}
                symbol={symbol}
                active={currentSymbol === symbol}
                onRemove={() => onRemoveWatchlist(symbol)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-600">Recently viewed</h2>
          <span className="text-[7px] font-bold uppercase tracking-[0.11em] text-zinc-700">Device only</span>
        </div>
        {recents.length === 0 ? (
          <EmptyList>Your recently opened workspaces stay on this device.</EmptyList>
        ) : (
          <div className="max-h-[230px] space-y-0.5 overflow-y-auto pr-0.5">
            {recents.slice(0, 10).map((symbol) => (
              <SymbolRow key={symbol} symbol={symbol} active={currentSymbol === symbol} />
            ))}
          </div>
        )}
      </section>

      <div className="rounded-xl border border-cyan-400/[0.09] bg-cyan-500/[0.025] px-3 py-3">
        <p className="text-[7px] font-black uppercase tracking-[0.16em] text-cyan-400/70">Workspace boundary</p>
        <p className="mt-1.5 text-[9px] font-semibold leading-relaxed text-zinc-600">Viewing an instrument does not add it to Canonical, ProX, Agent, or Paper Trading.</p>
      </div>
    </aside>
  );
}
