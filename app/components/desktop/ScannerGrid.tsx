"use client";

// Extracted verbatim from page.tsx's <section id="scanner"> — the "Ranked
// Attention Spike Feed". Already fully migrated to canonical
// /api/opportunities scoring (no local scoring calls in this section), so
// this is a pure JSX/props extraction with no behavior change.
import { motion } from "framer-motion";
import LiveStockValue from "@/app/components/market/LiveStockValue";
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
    <section id="scanner" className="ht-home-scanner mx-auto max-w-7xl px-5 pb-16 pt-5" aria-labelledby="home-scanner-title">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-start">
        <div>
          <p className="ht-section-label">Scanner</p>
          <h2 id="home-scanner-title" className="text-3xl font-black">Ranked attention feed</h2>
          <p className="mt-2 text-xs font-semibold text-green-300" role="status">Canonical ranked feed available</p>
          <p className="mt-2 text-sm text-zinc-500">
            Prices refresh independently of the ranked decision. Source age is shown below each price.
          </p>
        </div>

        <div className="flex gap-3">
          <label htmlFor="home-scanner-ticker" className="sr-only">Add ticker to scanner</label>
          <input
            id="home-scanner-ticker"
            type="text"
            placeholder="Add ticker, ex: PLTR"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addTicker();
              }
            }}
            className="ht-route-input min-w-0 flex-1 md:w-80"
          />

          <motion.button
            onClick={addTicker}
            className="ht-filter-control ht-filter-control--active px-6"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Add
          </motion.button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter Home scanner">
        {scannerFilters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setScannerFilter(filter.value)}
            aria-pressed={scannerFilter === filter.value}
            className={`ht-filter-control ${
              scannerFilter === filter.value
                ? "ht-filter-control--active"
                : ""
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <ol className="ht-home-scanner__list grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Home ranked attention results">
        {filteredOpportunities.map((opportunity, index) => {
          const isBullish = opportunity.change >= 0;
          const isHot = Math.abs(opportunity.change) > 4;
          const score = Math.round(opportunity.opportunityScore);
          const view = getOpportunityPresentation(opportunity);
          const attention = Math.round(opportunity.attentionScore);

          return (
            <motion.li
              key={opportunity.ticker}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: index * 0.05 }}
              viewport={{ once: true }}
              className="ht-home-scanner__card group relative overflow-hidden p-5 ht-compact-shell"
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
                  aria-label={`${watchlist.includes(opportunity.ticker) ? "Remove" : "Add"} ${opportunity.ticker} ${watchlist.includes(opportunity.ticker) ? "from" : "to"} watchlist`}
                  aria-pressed={watchlist.includes(opportunity.ticker)}
                  className="ht-icon-control"
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
                  <LiveStockValue symbol={opportunity.ticker} fallback={opportunity.price} />
                </h3>

                <p
                  className={`mt-2 text-xl font-black ${
                    isBullish ? "text-green-400" : "text-red-400"
                  }`}
                >
                  <LiveStockValue symbol={opportunity.ticker} field="change" fallback={opportunity.change} />
                </p>
                <p className="mt-1 text-[9px] text-zinc-500"><LiveStockValue symbol={opportunity.ticker} field="time" /></p>
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
            </motion.li>
          );
        })}

        {filteredOpportunities.length === 0 &&
          [1, 2, 3].map((item) => (
            <li
              key={item}
              className="ht-home-scanner__card p-5 ht-compact-shell"
            >
              <div role="status" aria-label="Loading scanner result">
                <div className="h-5 w-24 animate-pulse rounded bg-white/10" />
                <div className="mt-4 h-10 w-32 animate-pulse rounded bg-white/10" />
                <div className="mt-6 h-28 animate-pulse rounded-2xl bg-white/10" />
              </div>
            </li>
          ))}
      </ol>
    </section>
  );
}
