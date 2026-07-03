"use client";

import { useEffect, useState } from "react";

type Signal = {
  id: string;
  ticker: string;
  engine: string;
  scanned_at: string;
  entry_price: number;
  current_price: number | null;
  pct_move: number | null;
  ht_score: number;
  state: string;
  signal_state: string | null;
  pattern: string | null;
  change_percent: number;
  relative_volume: number;
  dual_engine: boolean;
  reasoning: string | null;
  upside_min: number | null;
  upside_max: number | null;
  risk_zone: number | null;
  rr_ratio: number | null;
  decision: string | null;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPrice(p: number | null) {
  if (!p) return "—";
  return `$${p.toFixed(2)}`;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "spot_momentum" | "before_the_crowd">("all");

  useEffect(() => {
    fetch("/api/signals-history")
      .then((r) => r.json())
      .then((data) => {
        setSignals(data.signals ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError("Failed to load signals. Please try again.");
        setLoading(false);
      });
  }, []);

  const filtered = filter === "all"
    ? signals
    : signals.filter((s) => s.engine === filter);

  const smCount = signals.filter(s => s.engine === "spot_momentum").length;
  const btcCount = signals.filter(s => s.engine === "before_the_crowd").length;
  const dualCount = signals.filter(s => s.dual_engine).length;
  const winners = signals.filter(s => s.pct_move !== null && s.pct_move > 0).length;
  const withMoves = signals.filter(s => s.pct_move !== null).length;

  return (
    <main className="min-h-screen bg-[#050505] text-white">

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-4">
          <a href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="HT Labs" className="h-8 w-auto" />
          </a>
          <nav className="hidden flex-1 items-center gap-6 text-sm font-semibold text-zinc-500 md:flex">
            <a className="transition hover:text-orange-300" href="/">Top Convictions</a>
            <a className="transition hover:text-orange-300" href="/scanner">Scanner</a>
            <a className="text-orange-400" href="/signals">Signals</a>
            <a className="transition hover:text-orange-300" href="/news">News</a>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-6 py-8">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-600">HT Labs</span>
            <span className="text-zinc-800">/</span>
            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">Signal History</span>
          </div>
          <h1 className="text-3xl font-black text-white mb-1">Recent Signals</h1>
          <p className="text-sm font-semibold text-zinc-500">
            Every pick HT Labs has made. Verify the calls yourself.
          </p>
        </div>

        {/* Stats row */}
        {!loading && signals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Total Signals", value: signals.length.toString(), color: "text-white" },
              { label: "Dual Engine", value: dualCount.toString(), color: "text-amber-400" },
              { label: "Spot Momentum", value: smCount.toString(), color: "text-violet-400" },
              {
                label: "Positive Moves",
                value: withMoves > 0 ? `${winners}/${withMoves}` : "—",
                color: winners > withMoves / 2 ? "text-green-400" : "text-red-400"
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border border-white/6 bg-black/40 px-4 py-3">
                <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-600 mb-1">{label}</p>
                <p className={`font-mono text-2xl font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-6">
          {[
            { key: "all", label: "All Signals" },
            { key: "spot_momentum", label: "Spot Momentum" },
            { key: "before_the_crowd", label: "Before The Crowd" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`rounded-full border px-4 py-1.5 text-xs font-black transition ${
                filter === key
                  ? key === "spot_momentum"
                    ? "border-violet-400/40 bg-violet-500/10 text-violet-300"
                    : key === "before_the_crowd"
                    ? "border-orange-400/40 bg-orange-500/10 text-orange-300"
                    : "border-white/20 bg-white/[0.06] text-white"
                  : "border-white/8 text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="rounded-xl border border-white/6 bg-black/40 h-20 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] px-5 py-4">
            <p className="text-sm font-semibold text-red-400">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-xl border border-white/6 bg-black/40 px-6 py-12 text-center">
            <p className="text-lg font-black text-white mb-2">No signals yet</p>
            <p className="text-sm font-semibold text-zinc-600">
              Signals appear here automatically as HT Labs selects top picks.
              {signals.length === 0
                ? " Check back after the market opens."
                : " Try a different filter."}
            </p>
          </div>
        )}

        {/* Signal table */}
        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-2">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1.2fr_0.8fr_0.8fr_1fr_1fr] gap-4 px-4 py-2 text-[8px] font-black uppercase tracking-[0.16em] text-zinc-700">
              <span>Ticker / Engine</span>
              <span>When</span>
              <span>Entry</span>
              <span>Current</span>
              <span>Move</span>
              <span>Window</span>
            </div>

            {filtered.map((signal) => {
              const isSM = signal.engine === "spot_momentum";
              const isPositive = signal.pct_move !== null && signal.pct_move >= 0;
              const hasWindow = signal.upside_min != null && signal.risk_zone != null;

              return (
                <div
                  key={signal.id}
                  className={`grid grid-cols-[1fr_1.2fr_0.8fr_0.8fr_1fr_1fr] gap-4 items-center px-4 py-4 rounded-xl border transition ${
                    isSM
                      ? "border-violet-400/10 bg-violet-500/[0.02] hover:border-violet-400/20"
                      : "border-orange-400/10 bg-orange-500/[0.02] hover:border-orange-400/20"
                  }`}
                >
                  {/* Ticker + engine */}
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-black text-white">{signal.ticker}</span>
                        {signal.dual_engine && (
                          <span className="text-[8px] font-black text-amber-400">⚡</span>
                        )}
                      </div>
                      <span className={`text-[9px] font-black ${isSM ? "text-violet-500" : "text-orange-500"}`}>
                        {isSM ? "Spot Momentum" : "Before The Crowd"}
                      </span>
                    </div>
                  </div>

                  {/* When */}
                  <div>
                    <p className="text-xs font-semibold text-zinc-400">{formatDate(signal.scanned_at)}</p>
                    {signal.state && (
                      <p className="text-[9px] font-semibold text-zinc-600 mt-0.5">{signal.state}</p>
                    )}
                  </div>

                  {/* Entry price */}
                  <div>
                    <p className="font-mono text-sm font-black text-white">{formatPrice(signal.entry_price)}</p>
                    {signal.ht_score > 0 && (
                      <p className="text-[9px] font-semibold text-zinc-600 mt-0.5">HT {signal.ht_score}</p>
                    )}
                  </div>

                  {/* Current price */}
                  <div>
                    <p className="font-mono text-sm font-black text-zinc-400">
                      {formatPrice(signal.current_price)}
                    </p>
                  </div>

                  {/* % Move */}
                  <div>
                    {signal.pct_move !== null ? (
                      <div className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 ${
                        isPositive
                          ? "border-green-400/25 bg-green-500/[0.06] text-green-400"
                          : "border-red-400/25 bg-red-500/[0.06] text-red-400"
                      }`}>
                        <span className="font-mono text-sm font-black">
                          {isPositive ? "+" : ""}{signal.pct_move.toFixed(2)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-zinc-700">Pending</span>
                    )}
                  </div>

                  {/* Opportunity Window */}
                  <div>
                    {hasWindow ? (
                      <div>
                        <p className="text-[9px] font-black text-green-400">
                          +{signal.upside_min}% → +{signal.upside_max}%
                        </p>
                        <p className="text-[9px] font-semibold text-red-400 mt-0.5">
                          Risk -{signal.risk_zone}%
                          {signal.rr_ratio ? ` · ${signal.rr_ratio}:1` : ""}
                        </p>
                      </div>
                    ) : (
                      <span className="text-[9px] font-semibold text-zinc-700">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Reasoning panel - shows on hover/expanded, for now just show inline if available */}
        {!loading && filtered.some(s => s.reasoning) && (
          <div className="mt-8 rounded-xl border border-white/6 bg-black/40 px-5 py-4">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600 mb-1">About Signal History</p>
            <p className="text-xs font-semibold text-zinc-500 leading-5">
              These are the actual picks made by the HT Labs engine in real time. Entry price is recorded at the moment of selection. Current price updates live. Percentage move reflects performance since selection — not a forward-looking target.
            </p>
            <p className="text-[9px] font-semibold text-zinc-700 mt-2">
              Signals are for research only, not financial advice.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
