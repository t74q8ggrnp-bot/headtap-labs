"use client";

import { useEffect, useState } from "react";
import { PanelHeader, StatusState } from "@/app/components/ui/ApplicationPrimitives";

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
      .catch(() => {
        setError("Failed to load signals. Please try again.");
        setLoading(false);
      });
  }, []);

  const filtered = filter === "all"
    ? signals
    : signals.filter((s) => s.engine === filter);

  const smCount = signals.filter(s => s.engine === "spot_momentum").length;
  const dualCount = signals.filter(s => s.dual_engine).length;
  const winners = signals.filter(s => s.pct_move !== null && s.pct_move > 0).length;
  const withMoves = signals.filter(s => s.pct_move !== null).length;

  return (
    <main className="ht-discovery-route ht-signals-route min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-[1400px] px-5 py-8 sm:px-6">

        {/* Page header */}
        <PanelHeader
          headingLevel={1}
          eyebrow="Signal history"
          title="Recent signals"
          description="Backend-recorded selections with entry price, current price, measured move, and the opportunity window available at selection time."
          className="mb-7"
        />

        {/* Stats row */}
        {!loading && signals.length > 0 && (
          <dl className="ht-route-metrics mb-8 grid grid-cols-2 md:grid-cols-4" aria-label="Signal history summary">
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
              <div key={label} className="ht-route-metric">
                <dt>{label}</dt>
                <dd className={color}>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Filter tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Filter signal history">
          {[
            { key: "all", label: "All Signals" },
            { key: "spot_momentum", label: "Spot Momentum" },
            { key: "before_the_crowd", label: "Before The Crowd" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              aria-pressed={filter === key}
              className={`ht-filter-control ${
                filter === key
                  ? "ht-filter-control--active"
                  : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <StatusState busy title="Loading signal history" description="Retrieving recorded selections and measured outcomes." />
        )}

        {/* Error */}
        {error && (
          <StatusState tone="negative" title="Signal history unavailable" description={error} />
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <StatusState
            title="No signals yet"
            description={`Signals appear here automatically as HT Labs records selections.${signals.length === 0 ? " Check back after the market opens." : " Try a different filter."}`}
          />
        )}

        {/* Signal table */}
        {!loading && !error && filtered.length > 0 && (
          <div className="ht-responsive-table-wrap">
            <table className="ht-intel-table">
              <caption className="sr-only">Recent HT Labs signals and measured performance</caption>
              <thead>
                <tr>
                  <th scope="col">Ticker / engine</th>
                  <th scope="col">When</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Current</th>
                  <th scope="col">Move</th>
                  <th scope="col">Window</th>
                </tr>
              </thead>
              <tbody>
            {filtered.map((signal) => {
              const isSM = signal.engine === "spot_momentum";
              const isPositive = signal.pct_move !== null && signal.pct_move >= 0;
              const hasWindow = signal.upside_min != null && signal.risk_zone != null;

              return (
                <tr
                  key={signal.id}
                  data-engine={isSM ? "spot-momentum" : "before-crowd"}
                >
                  {/* Ticker + engine */}
                  <td data-label="Ticker / engine">
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
                  </td>

                  {/* When */}
                  <td data-label="When">
                    <p className="text-xs font-semibold text-zinc-400">{formatDate(signal.scanned_at)}</p>
                    {signal.state && (
                      <p className="text-[9px] font-semibold text-zinc-600 mt-0.5">{signal.state}</p>
                    )}
                  </td>

                  {/* Entry price */}
                  <td data-label="Entry">
                    <p className="font-mono text-sm font-black text-white">{formatPrice(signal.entry_price)}</p>
                    {signal.ht_score > 0 && (
                      <p className="text-[9px] font-semibold text-zinc-600 mt-0.5">HT {signal.ht_score}</p>
                    )}
                  </td>

                  {/* Current price */}
                  <td data-label="Current">
                    <p className="font-mono text-sm font-black text-zinc-400">
                      {formatPrice(signal.current_price)}
                    </p>
                  </td>

                  {/* % Move */}
                  <td data-label="Move">
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
                  </td>

                  {/* Opportunity Window */}
                  <td data-label="Window">
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
                  </td>
                </tr>
              );
            })}
              </tbody>
            </table>
          </div>
        )}

        {/* Reasoning panel - shows on hover/expanded, for now just show inline if available */}
        {!loading && filtered.some(s => s.reasoning) && (
          <aside className="ht-route-note mt-8" aria-labelledby="signal-history-note">
            <p id="signal-history-note" className="ht-route-note__title">About signal history</p>
            <p className="text-xs font-semibold text-zinc-500 leading-5">
              These are the actual picks made by the HT Labs engine in real time. Entry price is recorded at the moment of selection. Current price updates live. Percentage move reflects performance since selection — not a forward-looking target.
            </p>
            <p className="text-[9px] font-semibold text-zinc-700 mt-2">
              Signals are for research only, not financial advice.
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}
