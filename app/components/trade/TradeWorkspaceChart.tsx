"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarketChartCanvas, {
  type ChartLayerSlots,
  type MarketChartIndicatorOverlays,
  type MarketChartMode,
} from "@/app/components/market/MarketChartCanvas";
import type { MarketChartBar } from "@/lib/market-chart";
import { summarizeMarketBars } from "@/lib/market-chart";
import {
  PHASE_ONE_MARKET_CHART_TIMEFRAMES,
  getMarketChartTimeframeMetadata,
  type MarketChartTimeframe,
} from "@/lib/market-chart-timeframes";
import { formatMarketPrice } from "@/lib/market-price-format";
import { resolveTradeWorkspaceChartHeight } from "@/lib/trade-workspace-layout";
import type { HtChartObject } from "@/lib/chart-objects";
import type { ChartLayerPreferences } from "@/app/hooks/useChartLayerPreferences";
import { StatusState } from "@/app/components/ui/ApplicationPrimitives";
import type { MarketChartVisibleRange } from "@/lib/market-chart-visible-range";

export type WorkspaceIndicatorVisibility = {
  vwap: boolean;
  ema9: boolean;
  ema20: boolean;
};

const indicatorStyles = {
  vwap: "border-cyan-400/25 bg-cyan-500/10 text-cyan-300",
  ema9: "border-orange-400/25 bg-orange-500/10 text-orange-300",
  ema20: "border-violet-400/25 bg-violet-500/10 text-violet-300",
} as const;

const EMPTY_CHART_LAYER_HOST: ChartLayerSlots = Object.freeze({});

const visibleRanges = [
  { id: "1h", label: "1H" },
  { id: "2h", label: "2H" },
  { id: "session", label: "Session" },
] as const satisfies ReadonlyArray<{ id: MarketChartVisibleRange; label: string }>;

export default function TradeWorkspaceChart({
  symbol,
  bars,
  timeframe,
  onTimeframeChange,
  mode,
  onModeChange,
  indicators,
  layerVisibility,
  onToggleLayer,
  chartObjects,
  intelligenceLayersEnabled,
  loading,
  error,
}: {
  symbol: string;
  bars: readonly MarketChartBar[];
  timeframe: MarketChartTimeframe;
  onTimeframeChange: (timeframe: MarketChartTimeframe) => void;
  mode: MarketChartMode;
  onModeChange: (mode: MarketChartMode) => void;
  indicators: MarketChartIndicatorOverlays;
  layerVisibility: ChartLayerPreferences;
  onToggleLayer: (layer: keyof ChartLayerPreferences) => void;
  chartObjects: readonly HtChartObject[];
  intelligenceLayersEnabled: boolean;
  loading: boolean;
  error: string | null;
}) {
  const [layout, setLayout] = useState({ compact: false, height: 560 });
  const [visibleRange, setVisibleRange] = useState<MarketChartVisibleRange>("2h");
  const [latestResetToken, setLatestResetToken] = useState(0);
  const rangeSelectedByUserRef = useRef(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    let animationFrame = 0;
    const apply = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        setLayout({
          compact: query.matches,
          height: resolveTradeWorkspaceChartHeight({
            width: window.innerWidth,
            height: viewportHeight,
          }),
        });
        if (!rangeSelectedByUserRef.current) {
          setVisibleRange(query.matches ? "1h" : "2h");
        }
      });
    };
    apply();
    query.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      query.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);
  const { compact, height: chartHeight } = layout;

  const intervalSeconds = getMarketChartTimeframeMetadata(timeframe).intervalSeconds;
  const summary = useMemo(() => summarizeMarketBars([...bars]), [bars]);
  const chartIndicators = useMemo<MarketChartIndicatorOverlays>(() => ({
    ...(layerVisibility.vwap ? { vwap: indicators.vwap } : {}),
    ...(layerVisibility.ema9 ? { ema9: indicators.ema9 } : {}),
    ...(layerVisibility.ema20 ? { ema20: indicators.ema20 } : {}),
  }), [layerVisibility, indicators]);
  const visibleChartObjects = useMemo(() => chartObjects.filter((object) =>
    (object.authority === "agent" && layerVisibility.agent) ||
    (object.authority === "prox" && layerVisibility.prox),
  ), [chartObjects, layerVisibility.agent, layerVisibility.prox]);
  const selectVisibleRange = (range: MarketChartVisibleRange) => {
    rangeSelectedByUserRef.current = true;
    setVisibleRange(range);
  };

  return (
    <section className="ht-workspace-panel ht-workspace-chart overflow-hidden" aria-label={`${symbol} market chart`}>
      <div className="ht-workspace-panel-header flex flex-col gap-1 px-3 py-1.5 sm:gap-3 sm:py-3 md:px-4">
        <div className="hidden sm:block">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.55)]" />
            <p className="text-[9px] font-black uppercase tracking-[0.19em] text-cyan-300">Verified price history</p>
          </div>
          <p className="mt-1 text-[8px] font-semibold text-zinc-600">One 1-minute provider frame · timeframes derived locally</p>
        </div>
        <div className="ht-workspace-chart-toolbar flex w-full min-w-0 items-center gap-2">
          <div className="ht-workspace-timeframes ht-workspace-segmented grid min-w-0 flex-[3] grid-cols-3 p-0.5 md:flex-none" role="group" aria-label="Chart timeframe">
            {PHASE_ONE_MARKET_CHART_TIMEFRAMES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={timeframe === option.id}
                onClick={() => onTimeframeChange(option.id)}
                className="ht-workspace-segment ht-tabular-numbers min-h-11 px-1 py-1.5 text-[9px] font-black sm:px-3 md:min-h-0"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="ht-workspace-modes ht-workspace-segmented grid min-w-0 flex-[2] grid-cols-2 p-0.5 md:flex-none" role="group" aria-label="Chart style">
            {(["graph", "candles"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => onModeChange(option)}
                className="ht-workspace-segment ht-workspace-segment--accent min-h-11 px-1.5 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] sm:px-2.5 md:min-h-0"
              >
                {option === "candles" ? "Candle" : "Line"}
              </button>
            ))}
          </div>
          <div className="ht-workspace-range min-w-0">
            <div className="ht-workspace-range__desktop ht-workspace-segmented" role="group" aria-label="Visible chart range">
              {visibleRanges.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={visibleRange === option.id}
                  onClick={() => selectVisibleRange(option.id)}
                  className="ht-workspace-segment ht-tabular-numbers"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="ht-workspace-range__mobile">
              <span>Range</span>
              <select
                aria-label="Visible chart range"
                value={visibleRange}
                onChange={(event) => selectVisibleRange(event.target.value as MarketChartVisibleRange)}
              >
                {visibleRanges.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="ht-workspace-latest"
            aria-label="Latest / reset visible chart range"
            onClick={() => setLatestResetToken((current) => current + 1)}
          >
            Latest
          </button>
        </div>
      </div>

      <div className="ht-workspace-layer-bar grid grid-cols-3 items-center gap-1.5 px-3 py-1 sm:flex sm:flex-wrap sm:py-2 md:px-4" role="group" aria-label="Chart layers">
        <span className="mr-1 hidden text-[7px] font-black uppercase tracking-[0.15em] text-zinc-600 sm:inline">Layers</span>
        {([
          ...(intelligenceLayersEnabled ? ["agent", "prox"] as const : []),
          "vwap", "ema9", "ema20", "volume",
        ] as const).map((indicator) => (
          <button
            key={indicator}
            type="button"
            aria-pressed={layerVisibility[indicator]}
            onClick={() => onToggleLayer(indicator)}
            className={`ht-workspace-layer-toggle min-h-11 rounded-full border px-1.5 py-1 font-mono text-[8px] font-black uppercase sm:min-h-0 sm:px-2.5 ${layerVisibility[indicator] ? (indicator in indicatorStyles ? indicatorStyles[indicator as keyof typeof indicatorStyles] : indicator === "agent" ? "border-orange-400/25 bg-orange-500/10 text-orange-300" : "border-violet-400/25 bg-violet-500/10 text-violet-300") : "border-white/[0.07] bg-white/[0.025] text-zinc-600 hover:text-zinc-400"}`}
          >
            {indicator === "ema9" ? "EMA 9" : indicator === "ema20" ? "EMA 20" : indicator === "agent" ? "Agent X" : indicator === "prox" ? "ProX" : indicator === "volume" ? "Volume" : "VWAP"}
          </button>
        ))}
        <span className="ml-auto hidden text-[7px] font-semibold text-zinc-700 sm:inline">Toggle locally · zero provider requests</span>
      </div>

      {loading && bars.length === 0 ? (
        <div className="flex items-center px-4" style={{ height: chartHeight }}>
          <StatusState className="w-full" title="Loading verified chart" description="Connecting to one provider-backed market frame." busy />
        </div>
      ) : bars.length === 0 ? (
        <div className="flex items-center px-4" style={{ height: chartHeight }}>
          <StatusState className="w-full" title="Verified chart unavailable" description={error || "No estimated candles are shown when the provider frame is unavailable."} tone="negative" />
        </div>
      ) : (
        <>
          <div className="relative" data-chart-timeframe={timeframe} data-chart-provider-requests-on-switch="0" data-chart-range-provider-requests-on-switch="0">
            <MarketChartCanvas
              bars={bars}
              intervalSeconds={intervalSeconds}
              mode={mode}
              accent="orange"
              height={chartHeight}
              compact={compact}
              timeZone="America/New_York"
              viewportKey={`workspace:${symbol}:${timeframe}`}
              indicators={chartIndicators}
              chartObjects={visibleChartObjects}
              showVolume={layerVisibility.volume}
              layerHost={EMPTY_CHART_LAYER_HOST}
              preserveEngineOnLocalControls
              visibleRange={visibleRange}
              latestResetToken={latestResetToken}
            />
          </div>
          <div className="ht-workspace-stat-grid grid grid-cols-4">
            {[
              ["Open", formatMarketPrice(summary?.open)],
              ["High", formatMarketPrice(summary?.high)],
              ["Low", formatMarketPrice(summary?.low)],
              ["Close", formatMarketPrice(summary?.close)],
            ].map(([label, value]) => (
              <div key={label} className="ht-workspace-stat min-w-0 px-2.5 py-2.5 md:px-3">
                <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-700">{label}</p>
                <p className="ht-tabular-numbers mt-1 truncate text-[9px] font-black text-zinc-300 md:text-[10px]">{value}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
