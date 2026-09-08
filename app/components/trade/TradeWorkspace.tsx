"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceInstrument } from "@/lib/instrument-search";
import type { MarketChartMode } from "@/app/components/market/MarketChartCanvas";
import { useMarketChartFeed } from "@/app/hooks/useMarketChartFeed";
import { useRecentlyViewed } from "@/app/hooks/useRecentlyViewed";
import { useWatchlist } from "@/app/hooks/useWatchlist";
import { summarizeMarketChartFeedEfficiency } from "@/lib/market-chart-feed";
import {
  deriveMarketChartTimeframeBars,
  type MarketChartTimeframe,
} from "@/lib/market-chart-timeframes";
import { calculateMarketIndicators } from "@/lib/market-indicators";
import {
  normalizeOpportunity,
  type Opportunity,
} from "@/lib/opportunity-model";
import TradeWorkspaceChart, {
  type WorkspaceIndicatorVisibility,
} from "@/app/components/trade/TradeWorkspaceChart";
import TradeWorkspaceHeader from "@/app/components/trade/TradeWorkspaceHeader";
import TradeWorkspaceIntelligence from "@/app/components/trade/TradeWorkspaceIntelligence";
import TradeWorkspaceLists from "@/app/components/trade/TradeWorkspaceLists";

type InstrumentPayload = {
  ok?: boolean;
  instrument?: WorkspaceInstrument;
  error?: string;
  code?: string;
};

type OpportunityPayload = {
  opportunity?: unknown;
  message?: string;
  error?: string;
};

type MobilePanel = "chart" | "intelligence" | "lists";

const MOBILE_PANELS: Array<{ id: MobilePanel; label: string }> = [
  { id: "chart", label: "Chart" },
  { id: "intelligence", label: "HT Read" },
  { id: "lists", label: "Lists" },
];

export default function TradeWorkspace({ symbol }: { symbol: string }) {
  const watchlist = useWatchlist();
  const recents = useRecentlyViewed();
  const [instrumentState, setInstrumentState] = useState<{
    symbol: string;
    instrument: WorkspaceInstrument | null;
    unavailable: boolean;
    message: string | null;
  }>({ symbol: "", instrument: null, unavailable: false, message: null });
  const [intelligenceState, setIntelligenceState] = useState<{
    symbol: string;
    opportunity: Opportunity | null;
    unavailable: boolean;
    message: string | null;
  }>({ symbol: "", opportunity: null, unavailable: false, message: null });
  const [timeframe, setTimeframe] = useState<MarketChartTimeframe>("1m");
  const [chartMode, setChartMode] = useState<MarketChartMode>("candles");
  const [indicatorsVisible, setIndicatorsVisible] = useState<WorkspaceIndicatorVisibility>({
    vwap: true,
    ema9: false,
    ema20: false,
  });
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chart");
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const instrument = instrumentState.symbol === symbol
    ? instrumentState.instrument
    : null;
  const instrumentLoading = instrumentState.symbol !== symbol;
  const instrumentUnavailable = instrumentState.symbol === symbol
    ? instrumentState.unavailable
    : false;
  const instrumentMessage = instrumentState.symbol === symbol
    ? instrumentState.message
    : null;
  const instrumentSupported = Boolean(
    instrument && instrument.workspaceSupported,
  );
  const marketFeed = useMarketChartFeed(symbol, {
    enabled: instrumentSupported,
    sessionScope: "extended",
  });

  const recentReady = recents.ready;
  const recordRecent = recents.record;
  useEffect(() => {
    if (!recentReady || !instrumentSupported) return;
    recordRecent(symbol);
  }, [instrumentSupported, recentReady, recordRecent, symbol]);

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`/api/instruments/${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as InstrumentPayload;
        if (
          !response.ok ||
          payload.ok !== true ||
          !payload.instrument ||
          !payload.instrument.workspaceSupported
        ) {
          throw new Error(payload.error || "Instrument profile unavailable.");
        }
        setInstrumentState({
          symbol,
          instrument: payload.instrument,
          unavailable: false,
          message: null,
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[trade-workspace] instrument profile unavailable", {
          symbol,
          reason: reason instanceof Error ? reason.message : "unknown",
        });
        setInstrumentState({
          symbol,
          instrument: null,
          unavailable: true,
          message:
            reason instanceof Error
              ? reason.message
              : "Instrument profile unavailable.",
        });
      });

    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    if (!instrumentSupported) return;
    const controller = new AbortController();

    void fetch(`/api/opportunity-ticker?ticker=${encodeURIComponent(symbol)}&mode=full`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as OpportunityPayload;
        if (!response.ok) {
          throw new Error(payload.error || "HT intelligence unavailable.");
        }
        if (payload.opportunity) {
          const normalized = normalizeOpportunity(payload.opportunity);
          setIntelligenceState({
            symbol,
            opportunity: normalized.ticker ? normalized : null,
            unavailable: false,
            message: normalized.ticker ? null : `No active HT read exists for ${symbol}.`,
          });
        } else {
          setIntelligenceState({
            symbol,
            opportunity: null,
            unavailable: false,
            message: payload.message || `${symbol} is not in the latest promoted Canonical decision frame.`,
          });
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setIntelligenceState({
          symbol,
          opportunity: null,
          unavailable: true,
          message: reason instanceof Error ? reason.message : "HT intelligence unavailable.",
        });
      });

    return () => controller.abort();
  }, [instrumentSupported, symbol]);

  const opportunity = intelligenceState.symbol === symbol
    ? intelligenceState.opportunity
    : null;
  const intelligenceLoading = intelligenceState.symbol !== symbol;
  const intelligenceUnavailable = intelligenceState.symbol === symbol
    ? intelligenceState.unavailable
    : false;
  const intelligenceMessage = intelligenceState.symbol === symbol
    ? intelligenceState.message
    : null;
  const baseBars = useMemo(
    () => marketFeed.frame?.chart.bars ?? [],
    [marketFeed.frame],
  );
  const displayedBars = useMemo(
    () => deriveMarketChartTimeframeBars(baseBars, timeframe),
    [baseBars, timeframe],
  );
  const indicators = useMemo(
    () => calculateMarketIndicators(displayedBars, {
      vwapResetMode: "eastern_date",
      precision: 8,
    }),
    [displayedBars],
  );
  const efficiency = useMemo(
    () => marketFeed.frame
      ? summarizeMarketChartFeedEfficiency(marketFeed.frame)
      : null,
    [marketFeed.frame],
  );
  const watched = watchlist.has(symbol);

  const toggleWatchlist = async () => {
    setWatchlistBusy(true);
    try {
      await watchlist.toggle(symbol);
    } finally {
      setWatchlistBusy(false);
    }
  };

  const removeWatchlist = (target: string) => {
    void watchlist.remove(target);
  };

  const lists = (
    <TradeWorkspaceLists
      currentSymbol={symbol}
      watchlist={watchlist.symbols}
      recents={recents.symbols}
      watchlistSyncState={watchlist.syncState}
      watchlistCloudEnabled={watchlist.cloudEnabled}
      onRemoveWatchlist={removeWatchlist}
    />
  );
  const chart = (
    <TradeWorkspaceChart
      symbol={symbol}
      bars={displayedBars}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      mode={chartMode}
      onModeChange={setChartMode}
      indicators={indicators}
      indicatorVisibility={indicatorsVisible}
      onToggleIndicator={(indicator) => {
        setIndicatorsVisible((current) => ({
          ...current,
          [indicator]: !current[indicator],
        }));
      }}
      loading={instrumentLoading || marketFeed.loading}
      error={instrumentUnavailable ? instrumentMessage : marketFeed.error}
    />
  );
  const intelligence = (
    <TradeWorkspaceIntelligence
      symbol={symbol}
      opportunity={instrumentSupported ? opportunity : null}
      loading={instrumentLoading || (instrumentSupported && intelligenceLoading)}
      unavailable={instrumentUnavailable || intelligenceUnavailable}
      message={instrumentUnavailable ? instrumentMessage : intelligenceMessage}
    />
  );

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_48%_-10%,rgba(249,115,22,0.09),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(34,211,238,0.045),transparent_22%),#050607] px-2 pb-24 pt-2 text-white sm:px-3 sm:pt-3 md:px-5 md:pb-8 md:pt-5"
      data-trade-workspace={symbol}
      data-feed-version="market-chart-feed-v1"
    >
      <div className="mx-auto max-w-[1720px] overflow-hidden rounded-[22px] border border-white/[0.085] bg-[#080b0d]/95 shadow-[0_30px_100px_rgba(0,0,0,0.5)] sm:rounded-[26px]">
        <TradeWorkspaceHeader
          symbol={symbol}
          instrument={instrument}
          instrumentLoading={instrumentLoading}
          instrumentUnavailable={instrumentUnavailable}
          instrumentMessage={instrumentMessage}
          frame={marketFeed.frame}
          feedLoading={instrumentLoading || marketFeed.loading}
          reconnecting={marketFeed.reconnecting}
          feedError={marketFeed.error}
          feedLive={marketFeed.live}
          feedLabel={marketFeed.label}
          watched={watched}
          watchlistBusy={watchlistBusy || !instrumentSupported}
          onToggleWatchlist={() => void toggleWatchlist()}
          efficiency={efficiency}
        />

        <div className="border-b border-white/[0.06] px-3 py-2 lg:hidden">
          <div className="grid grid-cols-3 rounded-xl border border-white/[0.07] bg-black/35 p-1" role="tablist" aria-label="Workspace sections">
            {MOBILE_PANELS.map((panel) => (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={mobilePanel === panel.id}
                onClick={() => setMobilePanel(panel.id)}
                className={`rounded-lg px-2 py-2 text-[9px] font-black uppercase tracking-[0.11em] transition ${mobilePanel === panel.id ? "bg-white/[0.075] text-white shadow-sm" : "text-zinc-600"}`}
              >
                {panel.label}
                {panel.id === "lists" && watchlist.symbols.length > 0 ? ` · ${watchlist.symbols.length}` : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-h-[650px] lg:grid-cols-[240px_minmax(0,1fr)_340px] xl:grid-cols-[250px_minmax(0,1fr)_360px]">
          <div className={`${mobilePanel === "lists" ? "block" : "hidden"} border-white/[0.065] p-3 lg:block lg:border-r lg:p-4`}>
            {lists}
          </div>
          <div className={`${mobilePanel === "chart" ? "block" : "hidden"} min-w-0 border-white/[0.065] p-2.5 sm:p-3 md:p-4 lg:block xl:p-5`}>
            {chart}
          </div>
          <div className={`${mobilePanel === "intelligence" ? "block" : "hidden"} border-white/[0.065] p-3 md:p-4 lg:block lg:border-l`}>
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">HT Intelligence</h2>
              <span className="rounded-full border border-white/[0.065] bg-white/[0.025] px-2 py-1 text-[7px] font-black uppercase tracking-[0.1em] text-zinc-700">Existing read</span>
            </div>
            {intelligence}
          </div>
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[1720px] px-2 text-center text-[8px] font-semibold leading-relaxed text-zinc-700">
        HT Labs Trading Workspace is a research surface. Market data is provider-time stamped; opening Paper Trading does not submit an order.
      </p>
    </main>
  );
}
