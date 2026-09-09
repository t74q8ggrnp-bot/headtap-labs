"use client";

import { useEffect, useMemo, useState } from "react";
import MarketChartCanvas, {
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

export default function TradeWorkspaceChart({
  symbol,
  bars,
  timeframe,
  onTimeframeChange,
  mode,
  onModeChange,
  indicators,
  indicatorVisibility,
  onToggleIndicator,
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
  indicatorVisibility: WorkspaceIndicatorVisibility;
  onToggleIndicator: (indicator: keyof WorkspaceIndicatorVisibility) => void;
  loading: boolean;
  error: string | null;
}) {
  const [layout, setLayout] = useState({ compact: false, height: 560 });
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
    ...(indicatorVisibility.vwap ? { vwap: indicators.vwap } : {}),
    ...(indicatorVisibility.ema9 ? { ema9: indicators.ema9 } : {}),
    ...(indicatorVisibility.ema20 ? { ema20: indicators.ema20 } : {}),
  }), [indicatorVisibility, indicators]);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.075] bg-[#06090b]" aria-label={`${symbol} market chart`}>
      <div className="flex flex-col gap-1 border-b border-white/[0.065] px-3 py-1.5 sm:gap-3 sm:py-3 md:flex-row md:items-center md:justify-between md:px-4">
        <div className="hidden sm:block">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.55)]" />
            <p className="text-[9px] font-black uppercase tracking-[0.19em] text-cyan-300">Verified price history</p>
          </div>
          <p className="mt-1 text-[8px] font-semibold text-zinc-600">One 1-minute provider frame · timeframes derived locally</p>
        </div>
        <div className="flex w-full items-center gap-2 md:w-auto">
          <div className="grid min-w-0 flex-[3] grid-cols-3 rounded-lg border border-white/[0.075] bg-black/40 p-0.5 md:flex-none" role="group" aria-label="Chart timeframe">
            {PHASE_ONE_MARKET_CHART_TIMEFRAMES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={timeframe === option.id}
                onClick={() => onTimeframeChange(option.id)}
                className={`min-h-11 rounded-md px-1 py-1.5 font-mono text-[9px] font-black transition sm:px-3 md:min-h-0 ${timeframe === option.id ? "bg-white/[0.085] text-white" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid min-w-0 flex-[2] grid-cols-2 rounded-lg border border-white/[0.075] bg-black/40 p-0.5 md:flex-none" role="group" aria-label="Chart style">
            {(["graph", "candles"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => onModeChange(option)}
                className={`min-h-11 rounded-md px-1.5 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] transition sm:px-2.5 md:min-h-0 ${mode === option ? "bg-orange-500/15 text-orange-300" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {option === "candles" ? "Candle" : "Line"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 items-center gap-1.5 border-b border-white/[0.055] px-3 py-1 sm:flex sm:flex-wrap sm:py-2 md:px-4" role="group" aria-label="Chart indicators">
        <span className="mr-1 hidden text-[7px] font-black uppercase tracking-[0.15em] text-zinc-600 sm:inline">Indicators</span>
        {(["vwap", "ema9", "ema20"] as const).map((indicator) => (
          <button
            key={indicator}
            type="button"
            aria-pressed={indicatorVisibility[indicator]}
            onClick={() => onToggleIndicator(indicator)}
            className={`min-h-11 rounded-full border px-1.5 py-1 font-mono text-[8px] font-black uppercase transition sm:min-h-0 sm:px-2.5 ${indicatorVisibility[indicator] ? indicatorStyles[indicator] : "border-white/[0.07] bg-white/[0.025] text-zinc-600 hover:text-zinc-400"}`}
          >
            {indicator === "ema9" ? "EMA 9" : indicator === "ema20" ? "EMA 20" : "VWAP"}
          </button>
        ))}
        <span className="ml-auto hidden text-[7px] font-semibold text-zinc-700 sm:inline">Toggle locally · zero provider requests</span>
      </div>

      {loading && bars.length === 0 ? (
        <div className="flex animate-pulse flex-col items-center justify-center gap-3" style={{ height: chartHeight }}>
          <div className="h-1.5 w-2/3 rounded-full bg-white/[0.06]" />
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-zinc-700">Loading one verified market frame</p>
        </div>
      ) : bars.length === 0 ? (
        <div className="flex items-center justify-center px-6 text-center" style={{ height: chartHeight }}>
          <div>
            <p className="text-sm font-black text-zinc-300">Verified chart unavailable</p>
            <p className="mx-auto mt-2 max-w-sm text-[10px] font-semibold leading-relaxed text-zinc-600">{error || "No estimated candles are shown when the provider frame is unavailable."}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="relative" data-chart-timeframe={timeframe} data-chart-provider-requests-on-switch="0">
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
              layerHost={{}}
            />
          </div>
          <div className="grid grid-cols-4 border-t border-white/[0.06]">
            {[
              ["Open", formatMarketPrice(summary?.open)],
              ["High", formatMarketPrice(summary?.high)],
              ["Low", formatMarketPrice(summary?.low)],
              ["Close", formatMarketPrice(summary?.close)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 border-r border-white/[0.06] px-2.5 py-2.5 last:border-r-0 md:px-3">
                <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-700">{label}</p>
                <p className="mt-1 truncate font-mono text-[9px] font-black text-zinc-300 md:text-[10px]">{value}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
