"use client";

// app/trading-bot/page.tsx
//
// Read-only view of the paper trading bot. Separate system from Pro X and
// from canonical HT Labs scoring — this page only reflects bot_trades.

import { useEffect, useState } from "react";
import { matureReadOnlyFailure } from "@/lib/checkpoint-a-ui-state";
import { PanelHeader, StatusState } from "@/app/components/ui/ApplicationPrimitives";

type BotTrade = {
  id: string;
  ticker: string;
  status: string;
  entry_price: number | null;
  entry_at: string | null;
  position_notional: number;
  target_price: number | null;
  stop_price: number | null;
  high_water_mark: number | null;
  max_hold_until: string | null;
  exit_price: number | null;
  exit_at: string | null;
  exit_reason: string | null;
  pnl: number | null;
  pnl_percent: number | null;
  bot_score: number | null;
};

type Summary = {
  openCount: number;
  closedCount: number;
  winCount: number;
  winRate: number | null;
  totalPnl: number;
};

export default function TradingBotPage() {
  const [trades, setTrades] = useState<BotTrade[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/bot-trades?limit=100", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(matureReadOnlyFailure("trading-bot", res.status));
        } else {
          setError(null);
          setTrades(data.trades ?? []);
          setSummary(data.summary ?? null);
        }
      } catch {
        if (!cancelled) setError(matureReadOnlyFailure("trading-bot"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main className="ht-phase25-route ht-operator-route ht-trading-bot-route min-h-screen bg-black px-5 py-8 text-white" data-route-audience="operator">
      <div className="mx-auto max-w-5xl">
        <PanelHeader
          headingLevel={1}
          eyebrow="Internal operator surface · Paper Trading Bot"
          title="Trade Log"
          description="Alpaca paper money only. Separate from HT Labs scoring and Pro X; this read-only log reports the bot's own entries and exits."
          className="mb-6 px-0 pt-0"
        />

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Open</p>
            <p className="mt-1 text-2xl font-black">{summary?.openCount ?? "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Closed</p>
            <p className="mt-1 text-2xl font-black">{summary?.closedCount ?? "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Win Rate</p>
            <p className="mt-1 text-2xl font-black">{summary?.winRate !== null && summary?.winRate !== undefined ? `${summary.winRate}%` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4 sm:col-span-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Total P&amp;L</p>
            <p className={`mt-1 text-2xl font-black ${(summary?.totalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {summary ? `${summary.totalPnl >= 0 ? "+" : ""}$${summary.totalPnl.toFixed(2)}` : "—"}
            </p>
          </div>
        </div>

        {error && <StatusState title="Paper-bot log unavailable" description={error} tone="warning" role="alert" className="mb-6" />}

        {loading ? (
          <StatusState title="Loading paper-bot records" description="Reading the isolated bot trade log…" busy />
        ) : trades.length === 0 && !error ? (
          <StatusState title="No paper-bot trades" description="The bot has not recorded a qualifying paper trade, or new entries are disabled." />
        ) : (
          <div className="ht-operator-record-list flex flex-col gap-2" role="list" aria-label="Paper-bot trades">
            {trades.map((trade) => (
              <div
                key={trade.id}
                role="listitem"
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4"
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-lg font-black text-white">{trade.ticker}</span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                      trade.status === "open"
                        ? "border-violet-400/25 text-violet-300"
                        : (trade.pnl ?? 0) > 0
                          ? "border-green-400/25 text-green-300"
                          : "border-red-400/25 text-red-300"
                    }`}
                  >
                    {trade.status}
                    {trade.exit_reason ? ` · ${trade.exit_reason}` : ""}
                  </span>
                  <span className="text-xs text-zinc-500">entry ${trade.entry_price?.toFixed(2) ?? "—"}</span>
                </div>
                <div className="text-right">
                  {trade.status === "closed" && trade.pnl !== null ? (
                    <p className={`text-sm font-black ${trade.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)} ({trade.pnl_percent?.toFixed(1)}%)
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500">
                      peak ${trade.high_water_mark?.toFixed(2) ?? "—"} / hard stop ${trade.stop_price?.toFixed(2) ?? "—"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
