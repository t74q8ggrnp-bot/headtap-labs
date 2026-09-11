"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
import { marketChartPollingState } from "@/lib/market-chart-polling";
import { readWorkspaceInstrumentSeed } from "@/lib/workspace-instrument-seed";
import {
  normalizeWorkspaceCanonicalDecisionFrame,
  type WorkspaceCanonicalDecisionFrame,
} from "@/lib/workspace-intelligence-display";
import TradeWorkspaceChart from "@/app/components/trade/TradeWorkspaceChart";
import TradeWorkspaceHeader from "@/app/components/trade/TradeWorkspaceHeader";
import TradeWorkspaceIntelligence from "@/app/components/trade/TradeWorkspaceIntelligence";
import TradeWorkspaceLists from "@/app/components/trade/TradeWorkspaceLists";
import TradeWorkspaceAgentPlan from "@/app/components/trade/TradeWorkspaceAgentPlan";
import { useChartLayerPreferences } from "@/app/hooks/useChartLayerPreferences";
import { useAgentVisualPlan } from "@/app/hooks/useAgentVisualPlan";

type InstrumentPayload = {
  ok?: boolean;
  instrument?: WorkspaceInstrument;
  error?: string;
  code?: string;
};

type OpportunityPayload = {
  opportunity?: unknown;
  decisionFrame?: unknown;
  message?: string;
  error?: string;
};

type WorkspaceOpportunity = Opportunity & {
  decisionQuoteAsOf?: string | null;
  proxMarketDataAligned?: boolean | null;
};

function normalizeWorkspaceOpportunity(raw: unknown): WorkspaceOpportunity {
  const normalized = normalizeOpportunity(raw);
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const scoreContext = source.scoreContext &&
    typeof source.scoreContext === "object" &&
    !Array.isArray(source.scoreContext)
    ? source.scoreContext as Record<string, unknown>
    : {};
  return {
    ...normalized,
    decisionQuoteAsOf: typeof source.decisionQuoteAsOf === "string"
      ? source.decisionQuoteAsOf
      : null,
    proxMarketDataAligned: typeof scoreContext.proxMarketDataAligned === "boolean"
      ? scoreContext.proxMarketDataAligned
      : null,
  };
}

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
    opportunity: WorkspaceOpportunity | null;
    decisionFrame: WorkspaceCanonicalDecisionFrame | null;
    unavailable: boolean;
    message: string | null;
  }>({
    symbol: "",
    opportunity: null,
    decisionFrame: null,
    unavailable: false,
    message: null,
  });
  const [timeframe, setTimeframe] = useState<MarketChartTimeframe>("1m");
  const [chartMode, setChartMode] = useState<MarketChartMode>("candles");
  const chartLayers = useChartLayerPreferences();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chart");
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [intelligenceRefreshing, setIntelligenceRefreshing] = useState(false);
  const [intelligenceRefreshError, setIntelligenceRefreshError] = useState<string | null>(null);
  const intelligenceRefreshInFlight = useRef(false);
  const intelligenceRequestGeneration = useRef(0);
  const intelligenceRefreshController = useRef<AbortController | null>(null);
  const [wideWorkspace, setWideWorkspace] = useState(false);
  const panelIdPrefix = useId().replaceAll(":", "");
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
  const agentPlan = useAgentVisualPlan(symbol, instrumentSupported);
  const acceptTrustedTime = marketFeed.acceptTrustedTime;
  const marketSessionActive = marketFeed.nowMs > 0 && marketChartPollingState(
    new Date(marketFeed.nowMs),
    "extended",
  ).active;

  const recentReady = recents.ready;
  const recordRecent = recents.record;
  useEffect(() => {
    if (!recentReady || !instrumentSupported) return;
    recordRecent(symbol);
  }, [instrumentSupported, recentReady, recordRecent, symbol]);

  useEffect(() => {
    const seededInstrument = readWorkspaceInstrumentSeed(
      window.sessionStorage,
      symbol,
    );
    if (seededInstrument) {
      const seededUpdate = window.setTimeout(() => {
        setInstrumentState({
          symbol,
          instrument: seededInstrument,
          unavailable: false,
          message: null,
        });
      }, 0);
      return () => window.clearTimeout(seededUpdate);
    }
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
          throw new Error(response.status === 404
            ? `No supported instrument profile is available for ${symbol}.`
            : "Instrument details are temporarily unavailable. Try again shortly.");
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

  const loadIntelligence = useCallback(async (
    signal?: AbortSignal,
    preserveCurrent = false,
  ) => {
    const generation = ++intelligenceRequestGeneration.current;
    const requestSymbol = symbol;
    const requestIsCurrent = () =>
      !signal?.aborted &&
      generation === intelligenceRequestGeneration.current;
    try {
      const response = await fetch(
        `/api/opportunity-ticker?ticker=${encodeURIComponent(symbol)}&mode=full`,
        { cache: "no-store", signal },
      );
      acceptTrustedTime?.(response.headers.get("Date"));
      const payload = (await response.json()) as OpportunityPayload;
      if (!response.ok) {
        throw new Error(response.status === 404
          ? `No active HT read exists for ${requestSymbol}.`
          : "HT intelligence is temporarily unavailable. Existing chart data is unaffected.");
      }
      if (!requestIsCurrent()) return;
      if (payload.opportunity) {
        const normalized = normalizeWorkspaceOpportunity(payload.opportunity);
        const decisionFrame = normalizeWorkspaceCanonicalDecisionFrame(
          payload.decisionFrame,
        );
        acceptTrustedTime?.(decisionFrame?.presentedAt);
        setIntelligenceState({
          symbol: requestSymbol,
          opportunity: normalized.ticker ? normalized : null,
          decisionFrame,
          unavailable: false,
          message: normalized.ticker ? null : `No active HT read exists for ${requestSymbol}.`,
        });
      } else {
        setIntelligenceState({
          symbol: requestSymbol,
          opportunity: null,
          decisionFrame: null,
          unavailable: false,
          message: payload.message || `${requestSymbol} is not in the latest promoted Canonical decision frame.`,
        });
      }
      setIntelligenceRefreshError(null);
    } catch (reason: unknown) {
      if (!requestIsCurrent()) return;
      const message = reason instanceof Error
        ? reason.message
        : "HT intelligence unavailable.";
      if (preserveCurrent) {
        setIntelligenceRefreshError(message);
      } else {
        setIntelligenceState({
          symbol: requestSymbol,
          opportunity: null,
          decisionFrame: null,
          unavailable: true,
          message,
        });
      }
    }
  }, [acceptTrustedTime, symbol]);

  useEffect(() => {
    intelligenceRequestGeneration.current += 1;
    intelligenceRefreshController.current?.abort();
    intelligenceRefreshController.current = null;
    intelligenceRefreshInFlight.current = false;
    const clearPresentationState = window.setTimeout(() => {
      setIntelligenceRefreshing(false);
      setIntelligenceRefreshError(null);
    }, 0);
    return () => window.clearTimeout(clearPresentationState);
  }, [symbol]);

  useEffect(() => {
    if (!instrumentSupported) return;
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => {
      void loadIntelligence(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      controller.abort();
    };
  }, [instrumentSupported, loadIntelligence]);

  const refreshIntelligence = useCallback(async (showBusy = true) => {
    if (!instrumentSupported || intelligenceRefreshInFlight.current) return;
    const controller = new AbortController();
    intelligenceRefreshController.current = controller;
    intelligenceRefreshInFlight.current = true;
    if (showBusy) setIntelligenceRefreshing(true);
    try {
      await loadIntelligence(controller.signal, true);
    } finally {
      if (intelligenceRefreshController.current === controller) {
        intelligenceRefreshController.current = null;
        intelligenceRefreshInFlight.current = false;
        if (showBusy) setIntelligenceRefreshing(false);
      }
    }
  }, [instrumentSupported, loadIntelligence]);

  useEffect(() => {
    if (!instrumentSupported) return;
    const refreshWhenActiveAndVisible = () => {
      if (
        document.visibilityState === "visible" &&
        marketSessionActive
      ) {
        void refreshIntelligence(false);
      }
    };
    const interval = window.setInterval(refreshWhenActiveAndVisible, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshWhenActiveAndVisible();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [instrumentSupported, marketSessionActive, refreshIntelligence]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1180px)");
    const sync = () => setWideWorkspace(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const opportunity = intelligenceState.symbol === symbol
    ? intelligenceState.opportunity
    : null;
  const intelligenceLoading = intelligenceState.symbol !== symbol;
  const intelligenceUnavailable = intelligenceState.symbol === symbol
    ? intelligenceState.unavailable
    : false;
  const intelligenceDecisionFrame = intelligenceState.symbol === symbol
    ? intelligenceState.decisionFrame
    : null;
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
    <>
      <TradeWorkspaceChart
      symbol={symbol}
      bars={displayedBars}
      timeframe={timeframe}
      onTimeframeChange={setTimeframe}
      mode={chartMode}
      onModeChange={setChartMode}
      indicators={indicators}
      layerVisibility={chartLayers.preferences}
      onToggleLayer={chartLayers.toggle}
      chartObjects={agentPlan.read?.chartObjects ?? []}
      intelligenceLayersEnabled={agentPlan.read?.visible === true}
      loading={instrumentLoading || marketFeed.loading}
      error={instrumentUnavailable ? instrumentMessage : marketFeed.error}
      />
      <TradeWorkspaceAgentPlan read={agentPlan.read} />
    </>
  );
  const intelligence = (
    <TradeWorkspaceIntelligence
      symbol={symbol}
      opportunity={instrumentSupported ? opportunity : null}
      decisionFrame={instrumentSupported ? intelligenceDecisionFrame : null}
      loading={instrumentLoading || (instrumentSupported && intelligenceLoading)}
      unavailable={instrumentUnavailable || intelligenceUnavailable}
      message={instrumentUnavailable ? instrumentMessage : intelligenceMessage}
      chartAsOf={marketFeed.frame?.chart.displayQuote?.asOf ?? null}
      refreshError={intelligenceRefreshError}
      trustedNowMs={marketFeed.nowMs}
    />
  );

  const focusPanelTab = (panel: MobilePanel) => {
    document.getElementById(`${panelIdPrefix}-workspace-tab-${panel}`)?.focus();
  };

  const handlePanelKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    panel: MobilePanel,
  ) => {
    const currentIndex = MOBILE_PANELS.findIndex((item) => item.id === panel);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % MOBILE_PANELS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + MOBILE_PANELS.length) % MOBILE_PANELS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = MOBILE_PANELS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextPanel = MOBILE_PANELS[nextIndex].id;
    setMobilePanel(nextPanel);
    focusPanelTab(nextPanel);
  };

  return (
    <main
      className="ht-application-shell ht-trade-workspace min-h-screen w-full overflow-x-clip text-white"
      data-trade-workspace={symbol}
      data-feed-version="market-chart-feed-v1"
    >
      <div className="ht-trade-workspace__frame overflow-hidden">
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

        <div className="ht-workspace-mobile-tabs border-b px-3 py-2 min-[1180px]:hidden">
          <div className="ht-workspace-segmented grid grid-cols-3 p-1" role="tablist" aria-label="Workspace sections" aria-orientation="horizontal">
            {MOBILE_PANELS.map((panel) => (
              <button
                key={panel.id}
                id={`${panelIdPrefix}-workspace-tab-${panel.id}`}
                type="button"
                role="tab"
                aria-selected={mobilePanel === panel.id}
                aria-controls={`${panelIdPrefix}-workspace-panel-${panel.id}`}
                tabIndex={mobilePanel === panel.id ? 0 : -1}
                onClick={() => setMobilePanel(panel.id)}
                onKeyDown={(event) => handlePanelKeyDown(event, panel.id)}
                className="ht-workspace-segment min-h-11 px-2 py-2 text-[9px] font-black uppercase tracking-[0.11em]"
              >
                {panel.label}
                {panel.id === "lists" && watchlist.symbols.length > 0 ? ` · ${watchlist.symbols.length}` : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="ht-workspace-terminal-grid grid min-w-0 min-[1180px]:min-h-[650px] min-[1180px]:grid-cols-[220px_minmax(0,1fr)_330px]">
          <div
            id={`${panelIdPrefix}-workspace-panel-lists`}
            role={wideWorkspace ? "region" : "tabpanel"}
            aria-labelledby={wideWorkspace ? `${panelIdPrefix}-workspace-region-lists` : `${panelIdPrefix}-workspace-tab-lists`}
            className={`${mobilePanel === "lists" ? "block" : "hidden"} ht-workspace-column ht-workspace-column--lists min-w-0 p-3 min-[1180px]:block min-[1180px]:border-r min-[1180px]:p-3`}
          >
            <h2 id={`${panelIdPrefix}-workspace-region-lists`} className="sr-only">Workspace lists</h2>
            {lists}
          </div>
          <div
            id={`${panelIdPrefix}-workspace-panel-chart`}
            role={wideWorkspace ? "region" : "tabpanel"}
            aria-labelledby={wideWorkspace ? `${panelIdPrefix}-workspace-region-chart` : `${panelIdPrefix}-workspace-tab-chart`}
            className={`${mobilePanel === "chart" ? "block" : "hidden"} ht-workspace-chart-column min-w-0 min-[1180px]:block`}
          >
            <h2 id={`${panelIdPrefix}-workspace-region-chart`} className="sr-only">Verified market chart</h2>
            {chart}
          </div>
          <div
            id={`${panelIdPrefix}-workspace-panel-intelligence`}
            role={wideWorkspace ? "region" : "tabpanel"}
            aria-labelledby={wideWorkspace ? `${panelIdPrefix}-workspace-region-intelligence` : `${panelIdPrefix}-workspace-tab-intelligence`}
            className={`${mobilePanel === "intelligence" ? "block" : "hidden"} ht-workspace-column ht-workspace-column--intelligence min-w-0 p-3 md:p-4 min-[1180px]:block min-[1180px]:border-l min-[1180px]:p-3`}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 id={`${panelIdPrefix}-workspace-region-intelligence`} className="ht-workspace-eyebrow">HT Intelligence</h2>
              <button
                type="button"
                onClick={() => void refreshIntelligence(true)}
                disabled={!instrumentSupported || intelligenceRefreshing}
                className="ht-control min-h-11 px-3 text-[8px] uppercase tracking-[0.1em] min-[1180px]:min-h-8"
                data-variant="quiet"
                data-size="small"
              >
                {intelligenceRefreshing ? "Refreshing" : "Refresh read"}
              </button>
            </div>
            {intelligence}
          </div>
        </div>
      </div>
      <p className="ht-workspace-disclaimer px-3 py-2 text-center text-[8px] font-semibold leading-relaxed">
        HT Labs Trading Workspace is a research surface. Market data is provider-time stamped; opening Paper Trading does not submit an order.
      </p>
    </main>
  );
}
