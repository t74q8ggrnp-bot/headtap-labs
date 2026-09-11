"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import LiveStockValue from "@/app/components/market/LiveStockValue";
import {
  mergeOpportunityLists,
  type Opportunity as HTOpportunity,
} from "@/lib/opportunity-model";
import { useWatchlist } from "@/app/hooks/useWatchlist";
import { Control, PanelHeader, StatusState } from "@/app/components/ui/ApplicationPrimitives";

// ─────────────────────────────────────────────────────────────
//  app/scanner/page.tsx
//
//  Scanner now consumes the exact same ranked signal dataset as
//  Home — /api/opportunities — instead of its own hardcoded
//  ~130-stock watchlist and a second, disconnected scoring engine.
//
//  Home displays the #1 signal (limit=1).
//  Scanner displays the full ranked list (limit=100, matching
//  signal-writer's top-100 write ceiling — that's the actual
//  amount of real ranked data that exists at any moment).
//
//  One backend. One scoring engine. Two views of the same truth.
// ─────────────────────────────────────────────────────────────

type ScannerFilter = "all" | "momentum" | "before_crowd" | "catalyst" | "watchlist";

const FILTERS: { label: string; value: ScannerFilter }[] = [
  { label: "All Names", value: "all" },
  { label: "🔥 Momentum", value: "momentum" },
  { label: "👀 Before The Crowd", value: "before_crowd" },
  { label: "⚡ Catalyst", value: "catalyst" },
  { label: "⭐ Watchlist", value: "watchlist" },
];

const formatRelVol = (rvol: number): string => {
  if (!rvol || rvol <= 0) return "—";
  return `${rvol.toFixed(1)}x`;
};

// Tier bucketing on the canonical strategy score scale (0-100).
const getTier = (score: number) => {
  if (score >= 90) return { label: "Elite", color: "text-orange-300 bg-orange-500/15 border-orange-500/30" };
  if (score >= 85) return { label: "Strong", color: "text-green-300 bg-green-500/10 border-green-500/20" };
  if (score >= 65) return { label: "Developing", color: "text-yellow-300 bg-yellow-500/10 border-yellow-500/20" };
  return { label: "Watchlist", color: "text-zinc-400 bg-white/5 border-white/10" };
};

const getLabel = (o: HTOpportunity) => {
  if (o.catalystScore >= 20) return { emoji: "⚡", label: "Catalyst Active", color: "text-orange-300" };
  if (o.isBeforeCrowd) return { emoji: "👀", label: "Before The Crowd", color: "text-cyan-300" };
  if (o.relativeVolume >= 5 && o.change >= 5) return { emoji: "🔥", label: "Crowd Igniting", color: "text-orange-300" };
  if (o.change >= 15) return { emoji: "🚀", label: "Parabolic Move", color: "text-orange-300" };
  if (o.change >= 8) return { emoji: "🔥", label: "Hot Mover", color: "text-orange-300" };
  if (o.opportunityScore >= 90) return { emoji: "🎯", label: "Clean Breakout", color: "text-green-300" };
  if (o.relativeVolume >= 2) return { emoji: "📈", label: "Active", color: "text-green-300" };
  return { emoji: "🔎", label: "On Watch", color: "text-zinc-300" };
};

export default function ScannerPage() {
  const [opportunities, setOpportunities] = useState<HTOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<ScannerFilter>("all");
  const [search, setSearch] = useState("");
  const {
    symbols: watchlist,
    toggle: toggleWatchlistSymbol,
  } = useWatchlist();
  const [sortBy, setSortBy] = useState<"score" | "change" | "symbol">("score");

  const toggleWatchlist = (symbol: string) => {
    void toggleWatchlistSymbol(symbol);
  };

  const fetchAll = useCallback(async () => {
    try {
      setError(false);
      // The full ranked list — same endpoint, same scoring engine,
      // same live data Home's #1 pick comes from. No separate universe,
      // no separate scoring logic, no legacy fallback watchlist.
      const [momentumRes, beforeCrowdRes] = await Promise.all([
        fetch("/api/opportunities?limit=100"),
        fetch("/api/opportunities?type=before_crowd&limit=100"),
      ]);
      if (!momentumRes.ok || !beforeCrowdRes.ok) throw new Error("Ranked signal API unavailable");
      const [momentumData, beforeCrowdData] = await Promise.all([
        momentumRes.json(),
        beforeCrowdRes.json(),
      ]);
      setOpportunities(
        mergeOpportunityLists(
          momentumData.opportunities ?? [],
          beforeCrowdData.opportunities ?? [],
        ),
      );
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Scanner fetch failed", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchAll(), 0);
    const interval = setInterval(fetchAll, 30000);
    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchAll]);

  const filtered = useMemo(() => {
    let list = [...opportunities];
    if (search) list = list.filter(o => o.ticker.includes(search.toUpperCase()));
    if (filter === "momentum") list = list.filter(o => o.opportunityType === "momentum" || o.opportunityType === "breakout");
    if (filter === "before_crowd") list = list.filter(o => o.isBeforeCrowd);
    if (filter === "catalyst") list = list.filter(o => o.catalystScore >= 20);
    if (filter === "watchlist") list = list.filter(o => watchlist.includes(o.ticker));
    if (sortBy === "score") list = [...list].sort((a, b) => b.opportunityScore - a.opportunityScore);
    if (sortBy === "change") list = [...list].sort((a, b) => b.change - a.change);
    if (sortBy === "symbol") list = [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
    return list;
  }, [opportunities, filter, search, sortBy, watchlist]);

  const gainers = opportunities.filter(o => o.change > 0).length;
  const losers = opportunities.filter(o => o.change < 0).length;
  const unusual = opportunities.filter(o => o.relativeVolume >= 3).length;

  // Honest "market quiet" signal — same freshness labeling used across
  // the rest of the product, not a fake "everything is 0" heuristic.
  const isShowingStaleData = opportunities.length > 0 &&
    opportunities.every(o => o.freshnessLabel === "Last Verified Signal");

  return (
    <div className="ht-discovery-route ht-scanner-route min-h-screen bg-[#050505] text-white">
      <header className="ht-route-utility-bar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" aria-label="HT Labs home"><Image src="/logo.png" alt="" width={2909} height={1959} className="h-8 w-auto" priority /></Link>
          <div className="flex min-w-0 items-center gap-3">
            {lastUpdated && (
              <span className="hidden truncate text-xs font-semibold text-zinc-500 sm:block">
                Rankings received {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · prices update separately
              </span>
            )}
            <Control
              onClick={fetchAll}
              size="small"
              busy={loading}
            >
              Refresh
            </Control>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <PanelHeader
          headingLevel={1}
          eyebrow="Market discovery"
          title="Scanner"
          description="The complete canonical ranking behind Home. Rankings refresh every 30 seconds; displayed prices update independently."
          className="mb-7"
        />

        {!loading && (
          <dl className="ht-route-metrics mb-6 grid grid-cols-2 sm:grid-cols-4" aria-label="Scanner summary">
            {[
              { label: "Ranked", value: opportunities.length, color: "text-white" },
              { label: "Green", value: gainers, color: "text-green-300" },
              { label: "Red", value: losers, color: "text-red-300" },
              { label: "Unusual Volume", value: unusual, color: "text-orange-300" },
            ].map(({ label, value, color }) => (
              <div key={label} className="ht-route-metric">
                <dt>{label}</dt>
                <dd className={color}>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!loading && isShowingStaleData && (
          <StatusState className="mb-6" tone="warning" title="Market closed" description="Showing the last verified signals. Live scanning resumes when the market reopens." />
        )}

        {!loading && error && (
          <StatusState className="mb-6" tone="warning" title="Scanner temporarily unavailable" description="The last ranking could not be loaded. Refresh to try again." />
        )}

        {!loading && !error && opportunities.length === 0 && (
          <StatusState className="mb-6" title="No verified signals yet" description="The scanner has not found a qualifying candidate this cycle." />
        )}

        <div className="ht-route-controls mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter scanner results">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={`ht-filter-control ${
                  filter === f.value
                    ? "ht-filter-control--active"
                    : ""
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="scanner-search" className="sr-only">Search scanner by ticker</label>
            <input
              id="scanner-search"
              type="text"
              placeholder="Search ticker..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="ht-route-input min-w-0 flex-1 sm:w-40"
            />
            <label htmlFor="scanner-sort" className="sr-only">Sort scanner results</label>
            <select
              id="scanner-sort"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="ht-route-select"
            >
              <option value="score">Sort: Score</option>
              <option value="change">Sort: % Change</option>
              <option value="symbol">Sort: Symbol</option>
            </select>
          </div>
        </div>

        {loading ? (
          <StatusState busy title="Loading ranked signals" description="Retrieving the current canonical scanner board." />
        ) : error ? null : filtered.length === 0 ? (
          <StatusState title="No matching tickers" description="No ranked names match the selected filters." />
        ) : (
          <ol className="ht-market-card-list grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Ranked scanner results">
            {filtered.map((o, index) => {
              const tier = getTier(o.opportunityScore);
              const { emoji, label, color } = getLabel(o);
              const isBullish = o.change >= 0;
              return (
                <li
                  key={o.ticker}
                  className="ht-market-card"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10 text-xs font-black text-orange-400">
                        #{index + 1}
                      </div>
                      <div>
                        <p className="text-2xl font-black">{o.ticker}</p>
                        <p className={`text-[10px] font-black ${color}`}>{emoji} {label}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${tier.color}`}>
                        {tier.label} · {o.opportunityScore}
                      </span>
                      <button
                        onClick={() => toggleWatchlist(o.ticker)}
                        aria-label={`${watchlist.includes(o.ticker) ? "Remove" : "Add"} ${o.ticker} ${watchlist.includes(o.ticker) ? "from" : "to"} watchlist`}
                        aria-pressed={watchlist.includes(o.ticker)}
                        className="ht-icon-control"
                      >
                        {watchlist.includes(o.ticker) ? "⭐" : "☆"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-mono font-black"><LiveStockValue symbol={o.ticker} fallback={o.price} /></p>
                      <p className={`text-sm font-black ${isBullish ? "text-green-300" : "text-red-300"}`}>
                        <LiveStockValue symbol={o.ticker} field="change" fallback={o.change} />
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-600">Rel. Volume</p>
                      <p className={`font-mono text-lg font-black ${
                        o.relativeVolume >= 3 ? "text-orange-300" : "text-zinc-300"
                      }`}>
                        {formatRelVol(o.relativeVolume)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className={`rounded-full px-3 py-1 text-[10px] font-black ${
                      isBullish ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"
                    }`}>
                      {isBullish ? "↑ Bullish" : "↓ Bearish"}
                    </div>
                    {o.relativeVolume >= 3 && (
                      <div className="rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black text-orange-300">
                        ⚡ Unusual Vol
                      </div>
                    )}
                    {o.isBeforeCrowd && (
                      <div className="rounded-full bg-cyan-500/10 px-3 py-1 text-[10px] font-black text-cyan-300">
                        👀 Before Crowd
                      </div>
                    )}
                    {o.freshnessLabel === "Last Verified Signal" && (
                      <div className="rounded-full bg-zinc-500/10 px-3 py-1 text-[10px] font-black text-zinc-400">
                        Last Verified
                      </div>
                    )}
                    <Link
                      href={`/?ticker=${encodeURIComponent(o.ticker)}`}
                      className="ml-auto rounded-full border border-white/10 px-3 py-1 text-[10px] font-black text-zinc-300 transition hover:border-orange-500/30 hover:text-orange-300"
                    >
                      Full read →
                    </Link>
                    <Link
                      href={`/trade/${encodeURIComponent(o.ticker)}`}
                      className="rounded-full border border-orange-500/30 px-3 py-1 text-[10px] font-black text-orange-400 transition hover:bg-orange-500/10"
                    >
                      Workspace ↗
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <p className="mt-8 text-center text-[10px] font-semibold text-zinc-700">
          {filtered.length} names shown · {opportunities.length} ranked total · Same engine as Home · Refreshes every 30s
        </p>
      </main>
    </div>
  );
}
