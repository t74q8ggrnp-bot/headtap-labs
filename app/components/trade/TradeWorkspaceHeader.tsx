"use client";

import Image from "next/image";
import Link from "next/link";
import type { WorkspaceInstrument } from "@/lib/instrument-search";
import type { MarketChartFeedFrame } from "@/lib/market-chart-feed";
import { formatMarketPrice } from "@/lib/market-price-format";
import TickerSearchCombobox from "@/app/components/trade/TickerSearchCombobox";

export type FeedEfficiencySummary = {
  observedProviderRequests: number;
  acceptedEvidenceCount: number;
  reusedEvidenceCount: number;
  comparablePollingFrames: number;
  modeledLegacyRequests: number;
  modeledSavedRequests: number;
  reductionPercent: number;
};

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatProviderTime(value: string | null | undefined, includeDate = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Awaiting provider time";
  return new Intl.DateTimeFormat("en-US", {
    ...(includeDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

function sessionLabel(value: string | null | undefined) {
  if (value === "pre_market") return "Pre-market";
  if (value === "regular") return "Regular session";
  if (value === "after_hours") return "After hours";
  return "Closed / last session";
}

export default function TradeWorkspaceHeader({
  symbol,
  instrument,
  instrumentLoading,
  instrumentUnavailable,
  instrumentMessage,
  frame,
  feedLoading,
  reconnecting,
  feedError,
  feedLive,
  feedLabel,
  watched,
  watchlistBusy,
  onToggleWatchlist,
  efficiency,
}: {
  symbol: string;
  instrument: WorkspaceInstrument | null;
  instrumentLoading: boolean;
  instrumentUnavailable: boolean;
  instrumentMessage: string | null;
  frame: MarketChartFeedFrame | null;
  feedLoading: boolean;
  reconnecting: boolean;
  feedError: string | null;
  feedLive: boolean;
  feedLabel: string;
  watched: boolean;
  watchlistBusy: boolean;
  onToggleWatchlist: () => void;
  efficiency: FeedEfficiencySummary | null;
}) {
  const quote = frame?.chart.displayQuote;
  const positive = (quote?.changePercent ?? 0) >= 0;
  const authority = frame?.sessionAuthority;

  return (
    <header
      className="border-b border-white/[0.07]"
      data-market-symbol={symbol}
      data-market-price={quote?.price ?? ""}
      data-market-as-of={quote?.asOf ?? ""}
      data-market-frame-id={quote?.frameId ?? ""}
      data-market-frame-bucket={quote?.frameBucket ?? ""}
      data-market-session={authority?.providerSession ?? ""}
      data-market-live={feedLive ? "true" : "false"}
      data-instrument-availability={instrumentLoading ? "loading" : instrumentUnavailable ? "unavailable" : "available"}
    >
      <div className="flex items-center gap-3 border-b border-white/[0.055] px-3 py-3 md:px-5">
        <Link
          href="/"
          aria-label="Back to HT Labs"
          className="flex shrink-0 items-center gap-2 rounded-xl pr-1 transition hover:opacity-80"
        >
          <Image src="/logo.png" alt="HT Labs" width={2909} height={1959} priority className="h-8 w-auto" />
          <span className="hidden text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600 xl:inline">Workspace</span>
        </Link>
        <TickerSearchCombobox currentSymbol={symbol} compact />
        {!instrumentLoading && !instrumentUnavailable && (
          <Link
            href={`/paper?symbol=${encodeURIComponent(symbol)}`}
            className="hidden shrink-0 items-center gap-2 rounded-xl border border-orange-400/20 bg-orange-500/10 px-3.5 py-2.5 text-[10px] font-black uppercase tracking-[0.11em] text-orange-300 transition hover:border-orange-400/35 hover:bg-orange-500/15 sm:flex"
          >
            Open in Paper
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        )}
      </div>

      <div className="px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-mono text-3xl font-black tracking-[-0.055em] text-white sm:text-4xl">{symbol}</h1>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[8px] font-black uppercase tracking-[0.13em] text-zinc-500">
                {instrument?.assetKind === "etf" ? "ETF" : instrument?.assetKind === "stock" ? "Stock" : instrumentUnavailable ? "Unavailable" : "Verifying"}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.13em] ${feedLive ? "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300" : "border-white/[0.08] bg-white/[0.03] text-zinc-500"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${feedLive ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`} />
                {feedLive ? "Live provider frame" : instrumentUnavailable ? "Unavailable" : feedLoading ? "Connecting" : reconnecting ? "Reconnecting" : "Verified session"}
              </span>
            </div>
            <p className="mt-1.5 truncate text-[11px] font-semibold text-zinc-500 sm:text-xs">
              {instrument?.name || (instrumentLoading ? "Loading Massive instrument profile…" : instrumentMessage || "Instrument unavailable")}
              {instrument?.primaryExchange ? ` · ${instrument.primaryExchange}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-mono text-2xl font-black tracking-[-0.035em] text-zinc-50 sm:text-3xl">
                {formatMarketPrice(quote?.price)}
              </p>
              <p className={`font-mono text-sm font-black ${positive ? "text-emerald-400" : "text-red-400"}`}>
                {formatPercent(quote?.changePercent)}
              </p>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                {quote?.changeBasis === "previous_close" ? "from previous close" : quote?.changeBasis === "chart_open" ? "from chart open" : "verified change"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={watched}
              disabled={watchlistBusy}
              onClick={onToggleWatchlist}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-[10px] font-black uppercase tracking-[0.11em] transition disabled:opacity-50 ${watched ? "border-violet-400/30 bg-violet-500/10 text-violet-200" : "border-white/[0.09] bg-white/[0.035] text-zinc-400 hover:border-white/[0.15] hover:text-white"}`}
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill={watched ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
                <path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9z" />
              </svg>
              {watched ? "Watching" : "Watch"}
            </button>
            {!instrumentLoading && !instrumentUnavailable && (
              <Link
                href={`/paper?symbol=${encodeURIComponent(symbol)}`}
                className="inline-flex min-h-10 items-center rounded-xl border border-orange-400/20 bg-orange-500/10 px-3.5 text-[10px] font-black uppercase tracking-[0.11em] text-orange-300 sm:hidden"
              >
                Paper
              </Link>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-white/[0.065] bg-white/[0.065] sm:grid-cols-3">
          <div className="bg-[#080b0d] px-3 py-2.5">
            <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-700">Provider trade time</p>
            <p className="mt-1 font-mono text-[9px] font-bold text-zinc-400">{formatProviderTime(quote?.asOf, true)}</p>
          </div>
          <div className="bg-[#080b0d] px-3 py-2.5">
            <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-700">Candle interval</p>
            <p className="mt-1 font-mono text-[9px] font-bold text-zinc-400">{formatProviderTime(authority?.candleIntervalTimestamp, true)}</p>
          </div>
          <div className="bg-[#080b0d] px-3 py-2.5">
            <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-700">Provider event / chart scope</p>
            <p className="mt-1 font-mono text-[9px] font-bold text-zinc-400">
              {sessionLabel(authority?.providerSession)} · {authority?.sessionScope === "regular" ? "RTH only" : "Extended"} · {authority?.displayedSessionDate ?? "Date pending"}
            </p>
          </div>
        </div>

        <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[8px] font-bold text-zinc-600">
          <p aria-live="polite">
            {instrumentUnavailable ? instrumentMessage || "This instrument is unavailable in the Phase 1 workspace" : `${feedLabel} · ${feedError
              ? reconnecting
                ? "Live delta reconnecting · last verified frame remains visible"
                : feedError
              : authority?.displayPriceAppliedToCandle
                ? "Shared display price and current candle are provider-time aligned"
                : authority
                  ? `Display price kept separate from candle · ${authority.reason.replaceAll("_", " ")}`
                  : "Connecting to the shared market frame"}`}
          </p>
          {efficiency && (
            <details className="group">
              <summary className="cursor-pointer list-none font-mono text-zinc-600 transition hover:text-zinc-400">
                Feed design · {efficiency.reductionPercent.toFixed(1)}% below legacy model
              </summary>
              <p className="mt-1 rounded-lg border border-white/[0.06] bg-black/50 px-2 py-1.5 font-mono text-[8px] text-zinc-500">
                {efficiency.observedProviderRequests} origin provider calls / {efficiency.acceptedEvidenceCount} accepted evidence deliveries ({efficiency.reusedEvidenceCount} reused) · {efficiency.modeledLegacyRequests} modeled legacy calls across {efficiency.comparablePollingFrames} comparable REST frames
              </p>
            </details>
          )}
        </div>
      </div>
    </header>
  );
}
