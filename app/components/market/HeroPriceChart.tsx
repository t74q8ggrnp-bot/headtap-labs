"use client";

import { useMemo, useState } from "react";
import type {
  MarketChartAsset,
} from "@/lib/market-chart";
import type { MarketChartVisibleRange } from "@/lib/market-chart-visible-range";
import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";
import { formatMarketPrice as formatPrice } from "@/lib/market-price-format";
import MarketChartCanvas, {
  MARKET_CHART_ACCENTS,
  type MarketChartMode,
} from "@/app/components/market/MarketChartCanvas";

type HeroPriceChartProps = {
  asset: MarketChartAsset;
  symbol: string;
  productId?: string;
  accent?: "violet" | "orange" | "cyan";
  compact?: boolean;
  height?: number;
  title?: string;
  presentation?: "standard" | "feature";
  visibleRange?: MarketChartVisibleRange;
};

export default function HeroPriceChart({
  asset,
  symbol,
  productId,
  accent = "violet",
  compact = false,
  height,
  title = "Verified price history",
  presentation = "standard",
  visibleRange,
}: HeroPriceChartProps) {
  const marketView = useLiveMarketView(symbol, { asset, productId, chart: true });
  const [chartMode, setChartMode] = useState<MarketChartMode>("candles");
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
  );
  const palette = MARKET_CHART_ACCENTS[accent];
  const url = useMemo(() => {
    const params = new URLSearchParams({ asset, symbol });
    if (productId) params.set("productId", productId);
    return `/api/market-chart?${params.toString()}`;
  }, [asset, productId, symbol]);
  const data = marketView.chart;
  const failed = marketView.error && !data;
  const feature = presentation === "feature";
  const resolvedHeight = height ?? (feature ? 220 : compact ? 150 : 185);
  const viewportKey = `${url}:${compact ? "compact" : "full"}`;
  const latestTime = data
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
        timeZoneName: "short",
      }).format(new Date(data.latestAt))
    : null;
  const timeZoneLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "ET";

  return (
    <section
      className={feature
        ? "overflow-hidden bg-black"
        : `overflow-hidden rounded-2xl border ${palette.border} bg-black/35`}
      aria-label={`${symbol} ${title.toLowerCase()} chart`}
      data-market-symbol={symbol}
      data-market-as-of={marketView.quote?.asOf ?? ""}
      data-market-price={marketView.quote?.price ?? ""}
    >
      <div className={`${feature ? "flex items-center justify-between gap-3 px-1 pb-2 pt-1" : `border-b border-white/7 px-3 py-2.5 ${compact ? "space-y-2.5 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0" : "flex flex-wrap items-center justify-between gap-2"}`}`}>
        <div className={compact ? "flex items-start justify-between gap-3" : ""}>
          <div>
            <p className={`text-[8px] font-black uppercase tracking-[0.2em] ${palette.text}`}>
              {title}
            </p>
            <p className="mt-0.5 text-[8px] font-semibold text-zinc-700">
              {feature
                ? `${symbol} · verified provider candles`
                : data
                ? `${data.windowLabel} · ${data.sourceLabel} · ${chartMode === "candles" ? "OHLC" : "close graph"}`
                : "Provider-backed market history"}
            </p>
            <p className="mt-1 text-[8px] font-semibold text-zinc-500" aria-live="off">
              {marketView.label}{marketView.quote ? ` · ${new Date(marketView.quote.asOf).toLocaleTimeString("en-US", { timeZone, timeZoneName: "short" })}` : ""}
            </p>
          </div>
          {compact && latestTime && !feature && (
            <p className="shrink-0 font-mono text-[8px] font-bold text-zinc-600">
              Candle interval {latestTime}
            </p>
          )}
        </div>
        {feature ? (
          <div className="grid shrink-0 grid-cols-2 gap-1" role="group" aria-label="Top Opportunity chart display">
            {(["graph", "candles"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={chartMode === mode}
                onClick={() => setChartMode(mode)}
                className={`px-2 py-1 text-[8px] font-black transition ${chartMode === mode ? palette.text : "text-zinc-600"}`}
              >
                {mode === "graph" ? "Chart" : "Candles"}
              </button>
            ))}
          </div>
        ) : <div className={`flex items-center gap-2 ${compact ? "w-full sm:w-auto" : ""}`}>
          <div
            className={`grid grid-cols-2 rounded-lg border border-white/8 bg-white/[0.025] p-0.5 ${compact ? "w-full sm:w-auto" : ""}`}
            role="group"
            aria-label="Chart display"
          >
            {(["graph", "candles"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={chartMode === mode}
                onClick={() => setChartMode(mode)}
                className={`rounded-md px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.1em] transition ${
                  chartMode === mode
                    ? `${palette.text} bg-white/[0.07]`
                    : "text-zinc-700 hover:text-zinc-500"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          {!compact && latestTime && (
            <p className="font-mono text-[8px] font-bold text-zinc-600">
              Candle interval {latestTime}
            </p>
          )}
        </div>}
      </div>

      {failed ? (
        <div className="flex items-center justify-center px-4 text-center" style={{ height: resolvedHeight }}>
          <p className="text-[10px] font-semibold text-zinc-600">
            Verified chart temporarily unavailable. No estimated data is shown.
          </p>
        </div>
      ) : !data ? (
        <div className="flex animate-pulse flex-col items-center justify-center gap-3" style={{ height: resolvedHeight }}>
          <div className="h-1.5 w-2/3 rounded-full bg-white/7" />
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-zinc-700">
            Loading verified price history
          </p>
        </div>
      ) : (
        <>
          <MarketChartCanvas
            bars={data.bars}
            intervalSeconds={data.intervalSeconds ?? 60}
            mode={chartMode}
            accent={accent}
            compact={compact}
            height={resolvedHeight}
            timeZone={timeZone}
            viewportKey={viewportKey}
            visibleRange={visibleRange}
          />
          <div className={`${feature ? "px-1 py-2" : "border-t border-white/7 px-3 py-1.5"} flex flex-wrap items-center justify-between gap-1`}>
            <p className="text-[7px] font-semibold text-zinc-700">
              {feature
                ? "Drag to inspect · verified provider intervals"
                : chartMode === "candles"
                ? "Candles show open, high, low + close · drag to inspect"
                : "Graph connects verified closes · drag to inspect"}
            </p>
            <p className="font-mono text-[7px] font-bold uppercase text-zinc-700">
              Times shown {timeZoneLabel}
            </p>
          </div>
          {!feature && <div className="grid grid-cols-4 border-t border-white/7">
            {[
              ["Open", formatPrice(data.summary.open)],
              ["High", formatPrice(data.summary.high)],
              ["Low", formatPrice(data.summary.low)],
              ["From chart open", `${data.summary.changePercent >= 0 ? "+" : ""}${data.summary.changePercent.toFixed(1)}%`],
            ].map(([label, value]) => (
              <div key={label} className="border-r border-white/7 px-2 py-2.5 last:border-r-0">
                <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-700">{label}</p>
                <p className={`mt-1 truncate font-mono text-[10px] font-black ${label === "From chart open" ? (data.summary.changePercent >= 0 ? "text-green-400" : "text-red-400") : "text-zinc-300"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>}
        </>
      )}
    </section>
  );
}
