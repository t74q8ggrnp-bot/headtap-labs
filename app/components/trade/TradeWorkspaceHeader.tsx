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
  const feedUnavailable = !feedLoading && !frame;
  const compactFeedStatus = feedLive
    ? "Live"
    : instrumentUnavailable || feedUnavailable
      ? "Unavailable"
      : feedLoading
        ? "Connecting"
        : reconnecting
          ? "Retrying"
          : "Verified";
  const fullFeedStatus = feedLive
    ? "Live provider frame"
    : instrumentUnavailable || feedUnavailable
      ? "Verified frame unavailable"
      : feedLoading
        ? "Connecting"
        : reconnecting
          ? "Reconnecting"
          : "Verified session";

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
      <div className="flex min-w-0 items-center gap-2 border-b border-white/[0.055] px-2.5 py-1.5 sm:gap-3 sm:px-3 sm:py-3 md:px-5 lg:py-2 2xl:py-3">
        <Link
          href="/"
          aria-label="Back to HT Labs"
          className="flex shrink-0 items-center gap-2 rounded-xl pr-1 transition hover:opacity-80"
        >
          <Image src="/logo.png" alt="HT Labs" width={2909} height={1959} priority className="h-6 w-auto sm:h-8" />
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

      <div className="px-3 py-2 sm:px-4 sm:py-4 md:px-6 md:py-5 lg:py-3 2xl:py-5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
              <h1 className="font-mono text-2xl font-black tracking-[-0.055em] text-white sm:text-4xl lg:text-3xl 2xl:text-4xl">{symbol}</h1>
              <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[8px] font-black uppercase tracking-[0.13em] text-zinc-500 min-[390px]:inline-flex">
                {instrument?.assetKind === "etf" ? "ETF" : instrument?.assetKind === "stock" ? "Stock" : instrumentUnavailable ? "Unavailable" : "Verifying"}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.13em] ${feedLive ? "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300" : "border-white/[0.08] bg-white/[0.03] text-zinc-500"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${feedLive ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`} />
                <span className="sm:hidden">{compactFeedStatus}</span>
                <span className="hidden sm:inline">{fullFeedStatus}</span>
              </span>
            </div>
            <p className="mt-0.5 hidden max-w-[62vw] truncate text-[10px] font-semibold text-zinc-500 sm:mt-1.5 sm:block sm:max-w-none sm:text-xs lg:mt-1 2xl:mt-1.5">
              {instrument?.name || (instrumentLoading ? "Loading Massive instrument profile…" : instrumentMessage || "Instrument unavailable")}
              {instrument?.primaryExchange ? ` · ${instrument.primaryExchange}` : ""}
            </p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 sm:mt-3 sm:gap-x-3 lg:mt-1.5 2xl:mt-3">
              <p className="font-mono text-xl font-black tracking-[-0.035em] text-zinc-50 sm:text-3xl lg:text-2xl 2xl:text-3xl">
                {formatMarketPrice(quote?.price)}
              </p>
              <p className={`font-mono text-sm font-black ${positive ? "text-emerald-400" : "text-red-400"}`}>
                {formatPercent(quote?.changePercent)}
              </p>
              <p className="hidden text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600 sm:block">
                {quote?.changeBasis === "previous_close" ? "from previous close" : quote?.changeBasis === "chart_open" ? "from chart open" : "verified change"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              aria-pressed={watched}
              disabled={watchlistBusy}
              onClick={onToggleWatchlist}
              aria-label={watched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border px-2.5 text-[10px] font-black uppercase tracking-[0.11em] transition disabled:opacity-50 sm:min-h-10 sm:min-w-0 sm:px-3.5 ${watched ? "border-violet-400/30 bg-violet-500/10 text-violet-200" : "border-white/[0.09] bg-white/[0.035] text-zinc-400 hover:border-white/[0.15] hover:text-white"}`}
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill={watched ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
                <path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9z" />
              </svg>
              <span className="hidden sm:inline">{watched ? "Watching" : "Watch"}</span>
            </button>
            {!instrumentLoading && !instrumentUnavailable && (
              <Link
                href={`/paper?symbol=${encodeURIComponent(symbol)}`}
                className="inline-flex min-h-11 items-center rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 text-[9px] font-black uppercase tracking-[0.11em] text-orange-300 sm:hidden"
              >
                Paper
              </Link>
            )}
          </div>
        </div>

        <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[8px] font-bold sm:hidden">
          <p className="min-w-0 truncate font-mono text-zinc-400">
            {sessionLabel(authority?.providerSession)} · {formatProviderTime(quote?.asOf)}
          </p>
          <p className={`shrink-0 font-black uppercase tracking-[0.08em] ${authority?.displayPriceAppliedToCandle ? "text-cyan-300" : "text-zinc-500"}`}>
            {authority?.displayPriceAppliedToCandle ? "Price ↔ candle synced" : "Frame verifying"}
          </p>
        </div>

        <div className="mt-4 hidden gap-px overflow-hidden rounded-xl border border-white/[0.065] bg-white/[0.065] sm:grid sm:grid-cols-3 lg:mt-2 2xl:mt-4">
          <div className="bg-[#080b0d] px-3 py-2.5 lg:flex lg:min-w-0 lg:items-center lg:gap-2 lg:py-1.5 2xl:block 2xl:py-2.5">
            <p className="shrink-0 text-[7px] font-black uppercase tracking-[0.16em] text-zinc-700">Provider trade time</p>
            <p className="mt-1 font-mono text-[9px] font-bold text-zinc-400 lg:mt-0 lg:min-w-0 lg:truncate 2xl:mt-1">{formatProviderTime(quote?.asOf, true)}</p>
          </div>
          <div className="bg-[#080b0d] px-3 py-2.5 lg:flex lg:min-w-0 lg:items-center lg:gap-2 lg:py-1.5 2xl:block 2xl:py-2.5">
            <p className="shrink-0 text-[7px] font-black uppercase tracking-[0.16em] text-zinc-700">Candle interval</p>
            <p className="mt-1 font-mono text-[9px] font-bold text-zinc-400 lg:mt-0 lg:min-w-0 lg:truncate 2xl:mt-1">{formatProviderTime(authority?.candleIntervalTimestamp, true)}</p>
          </div>
          <div className="bg-[#080b0d] px-3 py-2.5 lg:flex lg:min-w-0 lg:items-center lg:gap-2 lg:py-1.5 2xl:block 2xl:py-2.5">
            <p className="shrink-0 text-[7px] font-black uppercase tracking-[0.16em] text-zinc-700">Provider event / chart scope</p>
            <p className="mt-1 font-mono text-[9px] font-bold text-zinc-400 lg:mt-0 lg:min-w-0 lg:truncate 2xl:mt-1">
              {sessionLabel(authority?.providerSession)} · {authority?.sessionScope === "regular" ? "RTH only" : "Extended"} · {authority?.displayedSessionDate ?? "Date pending"}
            </p>
          </div>
        </div>

        <div className="mt-2 hidden min-h-5 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[8px] font-bold text-zinc-500 sm:flex lg:mt-1 2xl:mt-2">
          <p className="min-w-0 leading-relaxed" aria-live="polite">
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
            <details className="group hidden md:block">
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
