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
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setCompact(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const intervalSeconds = getMarketChartTimeframeMetadata(timeframe).intervalSeconds;
  const summary = useMemo(() => summarizeMarketBars([...bars]), [bars]);
  const chartIndicators = useMemo<MarketChartIndicatorOverlays>(() => ({
    ...(indicatorVisibility.vwap ? { vwap: indicators.vwap } : {}),
    ...(indicatorVisibility.ema9 ? { ema9: indicators.ema9 } : {}),
    ...(indicatorVisibility.ema20 ? { ema20: indicators.ema20 } : {}),
  }), [indicatorVisibility, indicators]);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.075] bg-[#06090b]" aria-label={`${symbol} market chart`}>
      <div className="flex flex-col gap-3 border-b border-white/[0.065] px-3 py-3 sm:flex-row sm:items-center sm:justify-between md:px-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.55)]" />
            <p className="text-[9px] font-black uppercase tracking-[0.19em] text-cyan-300">Verified price history</p>
          </div>
          <p className="mt-1 text-[8px] font-semibold text-zinc-600">One 1-minute provider frame · timeframes derived locally</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-3 rounded-lg border border-white/[0.075] bg-black/40 p-0.5 sm:flex-none" role="group" aria-label="Chart timeframe">
            {PHASE_ONE_MARKET_CHART_TIMEFRAMES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={timeframe === option.id}
                onClick={() => onTimeframeChange(option.id)}
                className={`rounded-md px-3 py-1.5 font-mono text-[9px] font-black transition ${timeframe === option.id ? "bg-white/[0.085] text-white" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 rounded-lg border border-white/[0.075] bg-black/40 p-0.5" role="group" aria-label="Chart style">
            {(["graph", "candles"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => onModeChange(option)}
                className={`rounded-md px-2.5 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] transition ${mode === option ? "bg-orange-500/15 text-orange-300" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {option === "candles" ? "Candle" : "Line"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.055] px-3 py-2 md:px-4" role="group" aria-label="Chart indicators">
        <span className="mr-1 text-[7px] font-black uppercase tracking-[0.15em] text-zinc-700">Indicators</span>
        {(["vwap", "ema9", "ema20"] as const).map((indicator) => (
          <button
            key={indicator}
            type="button"
            aria-pressed={indicatorVisibility[indicator]}
            onClick={() => onToggleIndicator(indicator)}
            className={`rounded-full border px-2.5 py-1 font-mono text-[8px] font-black uppercase transition ${indicatorVisibility[indicator] ? indicatorStyles[indicator] : "border-white/[0.07] bg-white/[0.025] text-zinc-600 hover:text-zinc-400"}`}
          >
            {indicator === "ema9" ? "EMA 9" : indicator === "ema20" ? "EMA 20" : "VWAP"}
          </button>
        ))}
        <span className="ml-auto hidden text-[7px] font-semibold text-zinc-700 sm:inline">Toggle locally · zero provider requests</span>
      </div>

      {loading && bars.length === 0 ? (
        <div className="flex h-[360px] animate-pulse flex-col items-center justify-center gap-3 md:h-[560px]">
          <div className="h-1.5 w-2/3 rounded-full bg-white/[0.06]" />
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-zinc-700">Loading one verified market frame</p>
        </div>
      ) : bars.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center px-6 text-center md:h-[560px]">
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
              height={compact ? 360 : 560}
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
