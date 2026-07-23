"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  mergeOpportunityLists,
  type Opportunity as HTOpportunity,
} from "@/lib/opportunity-model";

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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<ScannerFilter>("all");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"score" | "change" | "symbol">("score");

  // Same localStorage key Home uses — so a star toggled here shows up
  // there too. These were previously two different, disconnected lists.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("headtap-watchlist");
      if (saved) setWatchlist(JSON.parse(saved));
    } catch {}
  }, []);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      localStorage.setItem("headtap-watchlist", JSON.stringify(next));
      return next;
    });
  };

  const fetchAll = useCallback(async () => {
    try {
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
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
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,106,0,0.12),transparent_40%)]" />
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#050505]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-6">
            <a href="/"><img src="/logo.png" alt="HT Labs" className="h-10 w-auto" /></a>
            <nav className="hidden items-center gap-5 text-sm font-semibold text-zinc-500 md:flex">
              <a href="/" className="transition hover:text-orange-300">Dashboard</a>
              <span className="text-orange-400">Scanner</span>
              <a href="/news" className="transition hover:text-orange-300">News</a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="hidden text-[10px] font-black uppercase tracking-[0.15em] text-zinc-600 sm:block">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchAll}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black text-zinc-300 transition hover:border-orange-500/40 hover:text-orange-300"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-400">HT Labs</p>
          <h1 className="mt-1 text-4xl font-black tracking-tight">Full Scanner</h1>
          <p className="mt-2 text-sm text-zinc-500">The full ranked list from the same engine that picks Home's #1 signal. Auto-refreshes every 30s.</p>
        </div>

        {!loading && (
          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Ranked", value: opportunities.length, color: "text-white" },
              { label: "Green", value: gainers, color: "text-green-300" },
              { label: "Red", value: losers, color: "text-red-300" },
              { label: "Unusual Volume", value: unusual, color: "text-orange-300" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">{label}</p>
                <p className={`mt-1 font-mono text-xl font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {!loading && isShowingStaleData && (
          <div className="mb-6 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.05] px-5 py-3 flex items-center gap-3">
            <span className="text-lg">🌙</span>
            <div>
              <p className="text-sm font-black text-yellow-300">Market Quiet</p>
              <p className="text-[10px] font-semibold text-zinc-500">Showing the last verified signals. Live scanning resumes when the market reopens.</p>
            </div>
          </div>
        )}

        {!loading && opportunities.length === 0 && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-3">
            <p className="text-sm font-black text-zinc-300">No verified signals yet.</p>
            <p className="text-[10px] font-semibold text-zinc-500">The scanner hasn't found a qualifying candidate this cycle.</p>
          </div>
        )}

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                  filter === f.value
                    ? "border-orange-500 bg-orange-500 text-white"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-orange-500/40 hover:text-orange-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search ticker..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-2 text-sm outline-none placeholder:text-zinc-700 focus:border-orange-500 w-40"
            />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-400 outline-none focus:border-orange-500"
            >
              <option value="score">Sort: Score</option>
              <option value="change">Sort: % Change</option>
              <option value="symbol">Sort: Symbol</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              <p className="mt-4 text-sm font-semibold text-zinc-500">Loading ranked signals...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-32 text-center">
            <p className="text-zinc-500">No tickers match this filter right now.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((o, index) => {
              const tier = getTier(o.opportunityScore);
              const { emoji, label, color } = getLabel(o);
              const isBullish = o.change >= 0;
              return (
                <div
                  key={o.ticker}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-5 transition hover:border-orange-500/30"
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
                        className="text-sm transition hover:scale-110"
                      >
                        {watchlist.includes(o.ticker) ? "⭐" : "☆"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-mono font-black">${o.price.toFixed(2)}</p>
                      <p className={`text-sm font-black ${isBullish ? "text-green-300" : "text-red-300"}`}>
                        {isBullish ? "+" : ""}{o.change.toFixed(2)}%
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
                    <a
                      href={`/?ticker=${o.ticker}`}
                      className="ml-auto rounded-full border border-orange-500/30 px-3 py-1 text-[10px] font-black text-orange-400 transition hover:bg-orange-500/10"
                    >
                      Full Read →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-[10px] font-semibold text-zinc-700">
          {filtered.length} names shown · {opportunities.length} ranked total · Same engine as Home · Refreshes every 30s
        </p>
      </main>
    </div>
  );
}
