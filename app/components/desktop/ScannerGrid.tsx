"use client";

// Extracted verbatim from page.tsx's <section id="scanner"> — the "Ranked
// Attention Spike Feed". Already fully migrated to canonical
// /api/opportunities scoring (no local scoring calls in this section), so
// this is a pure JSX/props extraction with no behavior change.
import { motion } from "framer-motion";
import MiniStockChart from "@/app/components/MiniStockChart";
import {
  getOpportunityPresentation,
  opportunityToStock,
  type Opportunity as APIOpportunity,
} from "@/lib/opportunity-model";
import type { MarketStock as Stock } from "@/lib/contracts/market";

type ScannerFilter = "all" | "hot" | "bullish" | "watchlist";
type NewsItem = { headline?: string; summary?: string; source?: string; url?: string; datetime?: number };

export type ScannerGridProps = {
  ticker: string;
  setTicker: (value: string) => void;
  addTicker: () => void | Promise<void>;
  scannerFilters: { label: string; value: ScannerFilter }[];
  scannerFilter: ScannerFilter;
  setScannerFilter: (value: ScannerFilter) => void;
  filteredOpportunities: APIOpportunity[];
  watchlist: string[];
  toggleWatchlist: (symbol: string) => void;
  getTopNews: (symbol: string) => NewsItem | undefined;
  toggleSavedSetup: (symbol: string) => void;
  savedSetups: string[];
  openAiModal: (stock: Stock) => void | Promise<void>;
  aiLoading: boolean;
  selectedStock: Stock | null;
};

export default function ScannerGrid({
  ticker, setTicker, addTicker, scannerFilters, scannerFilter, setScannerFilter,
  filteredOpportunities, watchlist, toggleWatchlist, getTopNews, toggleSavedSetup,
  savedSetups, openAiModal, aiLoading, selectedStock,
}: ScannerGridProps) {
  return (
    <section id="scanner" className="mx-auto max-w-7xl px-5 py-5 pb-16">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-start">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
            Scanner
          </p>
          <h3 className="text-3xl font-black">Ranked Attention Spike Feed</h3>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-green-500/15 bg-green-500/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-green-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            Premium scan mode
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Auto-refreshes every 8 seconds.
          </p>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Add ticker, ex: PLTR"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addTicker();
              }
            }}
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-4 text-sm outline-none transition placeholder:text-zinc-700 focus:border-orange-500 focus:shadow-[0_0_25px_rgba(255,106,0,0.18)] md:w-80"
          />

          <motion.button
            onClick={addTicker}
            className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 text-sm font-black text-white shadow-[0_0_25px_rgba(255,106,0,0.25)] transition"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Add
          </motion.button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {scannerFilters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setScannerFilter(filter.value)}
            className={`rounded-full border px-4 py-2 text-xs font-black transition ${
              scannerFilter === filter.value
                ? "border-orange-500 bg-orange-500 text-white"
                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-orange-500/40 hover:text-orange-300"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredOpportunities.map((opportunity, index) => {
          const isBullish = opportunity.change >= 0;
          const isHot = Math.abs(opportunity.change) > 4;
          const score = Math.round(opportunity.opportunityScore);
          const view = getOpportunityPresentation(opportunity);
          const attention = Math.round(opportunity.attentionScore);

          return (
            <motion.div
              key={opportunity.ticker}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: index * 0.05 }}
              viewport={{ once: true }}
              whileHover={{ y: -6, scale: 1.015 }}
              className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 shadow-xl shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-orange-500/35 hover:bg-zinc-950/90 hover:shadow-[0_0_40px_rgba(255,106,0,0.12)] ht-compact-shell"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/80 to-transparent" />

              <div className="mb-5 flex items-start justify-start">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 text-sm font-black text-orange-400">
                    #{index + 1}
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                      Attention Spike
                    </p>

                    <h2 className="text-3xl font-black">{opportunity.ticker}</h2>
                  </div>
                </div>

                <button
                  onClick={() => toggleWatchlist(opportunity.ticker)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-orange-500/10"
                >
                  {watchlist.includes(opportunity.ticker) ? "⭐" : "☆"}
                </button>
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                <div
                  className={`rounded-full px-3 py-1 text-xs font-black ${
                    isBullish
                      ? "bg-green-500/15 text-green-400"
                      : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {isBullish ? "BULLISH" : "BEARISH"}
                </div>

                {isHot && (
                  <div className="rounded-full bg-orange-500 px-3 py-1 text-xs font-black text-white shadow-lg shadow-orange-500/30">
                    HOT MOVER
                  </div>
                )}

                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-zinc-400">
                  {view.riskLabel} RISK
                </div>

                <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                  SCORE {score}
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-500">Current Price</p>

                <h3 className="mt-1 text-4xl font-black">
                  ${Number(opportunity.price || 0).toFixed(2)}
                </h3>

                <p
                  className={`mt-2 text-xl font-black ${
                    isBullish ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {isBullish ? "+" : ""}
                  {Number(opportunity.change || 0).toFixed(2)}%
                </p>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/35 p-4">
                <div className="flex items-center justify-start">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                    Attention Score
                  </p>
                  <p className="text-sm font-black text-orange-300">
                    {attention}%
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-700 to-orange-400"
                    style={{ width: `${attention}%` }}
                  />
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-gradient-to-r from-orange-500/5 to-orange-900/5 p-3">
                <MiniStockChart
                  symbol={opportunity.ticker}
                  price={opportunity.price}
                  change={opportunity.change}
                />
              </div>

              <div className="mt-4 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                <div className="flex items-center justify-start gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                    Signal Strength
                  </p>
                  <p className="text-xs font-black text-green-300">
                    {(opportunity.tier ?? "scanner").toUpperCase()}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      RVOL
                    </p>
                    <p className="mt-1 text-lg font-black text-white">
                      {opportunity.relativeVolume.toFixed(1)}x
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Breakout
                    </p>
                    <p className="mt-1 text-lg font-black text-white">
                      {opportunity.breakoutPotentialLabel}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-orange-500/10 bg-orange-500/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                  Why It&apos;s Moving
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {opportunity.whyItMatters}
                </p>
              </div>

              {getTopNews(opportunity.ticker) && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="mb-2 flex items-center justify-start gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                      Live Catalyst
                    </p>
                    <span className="rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-black uppercase text-green-400">
                      News
                    </span>
                  </div>

                  <h4 className="text-sm font-black leading-5 text-white">
                    {getTopNews(opportunity.ticker)?.headline}
                  </h4>

                  {getTopNews(opportunity.ticker)?.summary && (
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">
                      {getTopNews(opportunity.ticker)?.summary}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-zinc-600">
                    {getTopNews(opportunity.ticker)?.source || "Market news"}
                  </p>
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-green-500/10 bg-green-500/[0.03] p-4">
                <div className="flex items-center justify-start gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                    Setup Snapshot
                  </p>

                  <div className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-black text-green-300">
                    {(opportunity.tier ?? "scanner").toUpperCase()} · {Math.round(opportunity.qualityScore)}/99
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Price Action
                    </p>
                    <p className="mt-1 text-sm font-black text-white">
                      {view.priceActionLabel}
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Momentum
                    </p>
                    <p className="mt-1 text-sm font-black text-white">
                      {view.momentumLabel}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {opportunity.riskTags.length > 0 ? (
                    opportunity.riskTags.map((tag) => (
                      <span key={tag} className="rounded-full border border-red-400/25 bg-red-500/[0.06] px-2.5 py-1 text-[10px] font-black text-red-300">
                        ⚠ {tag}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black text-zinc-400">
                      Standard Setup
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                  Risk Note
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {opportunity.riskNote}
                </p>
              </div>

              <button
                onClick={() => toggleSavedSetup(opportunity.ticker)}
                className={`mt-6 w-full rounded-2xl border px-4 py-3 text-sm font-black transition ${
                  savedSetups.includes(opportunity.ticker)
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
                }`}
              >
                {savedSetups.includes(opportunity.ticker)
                  ? "Saved Setup ✓"
                  : "Save Setup"}
              </button>

              <motion.button
                onClick={() => openAiModal(opportunityToStock(opportunity))}
                disabled={aiLoading}
                className="mt-3 w-full rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 py-4 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition disabled:opacity-50"
                whileHover={{ scale: aiLoading ? 1 : 1.02 }}
                whileTap={{ scale: aiLoading ? 1 : 0.97 }}
              >
                {aiLoading && selectedStock?.symbol === opportunity.ticker
                  ? "Analyzing..."
                  : "View AI Setup"}
              </motion.button>
            </motion.div>
          );
        })}

        {filteredOpportunities.length === 0 &&
          [1, 2, 3].map((item) => (
            <div
              key={item}
              className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 ht-compact-shell"
            >
              <div className="h-5 w-24 animate-pulse rounded bg-white/10" />
              <div className="mt-4 h-10 w-32 animate-pulse rounded bg-white/10" />
              <div className="mt-6 h-28 animate-pulse rounded-2xl bg-white/10" />
            </div>
          ))}
      </div>
    </section>
  );
}
