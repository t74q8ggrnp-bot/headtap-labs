"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, createChart, type LogicalRange, type UTCTimestamp } from "lightweight-charts";
import type { MarketChartBar } from "@/lib/market-chart";
import { formatMarketPrice } from "@/lib/market-price-format";

/** Receives the SAME saved publication as the price label. Never fetches quotes. */
export default function CoinApiResearchChart({ bars, marketId }: { bars: MarketChartBar[]; marketId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<{ marketId: string; range: LogicalRange | null } | null>(null);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  useEffect(() => {
    if (!container.current || !bars.length) return;
    const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    const chart = createChart(container.current, {
      autoSize: true, height: 280,
      layout: { background: { type: ColorType.Solid, color: "#070c0e" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#ffffff08" }, horzLines: { color: "#ffffff08" } },
      rightPriceScale: { borderColor: "#ffffff14" },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#ffffff14",
        tickMarkFormatter: (value: number) => time.format(value * 1_000) },
      localization: { priceFormatter: formatMarketPrice, timeFormatter: (value: number) => time.format(value * 1_000) },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true },
    });
    const smallestPrice = Math.min(...bars.map(bar => bar.low));
    const precision = smallestPrice < .001 ? Math.min(12, Math.ceil(-Math.log10(smallestPrice)) + 3) : smallestPrice < 1 ? 6 : 4;
    const priceFormat = { type: "custom" as const, formatter: formatMarketPrice, minMove: 10 ** -precision };
    if (mode === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#34d399", downColor: "#fb7185", wickUpColor: "#34d399", wickDownColor: "#fb7185",
        borderVisible: false, priceFormat,
      });
      series.setData(bars.map(bar => ({ ...bar, time: bar.time as UTCTimestamp })));
    } else {
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#22d3ee", topColor: "#22d3ee30", bottomColor: "#22d3ee00", priceFormat,
      });
      series.setData(bars.map(bar => ({ time: bar.time as UTCTimestamp, value: bar.close })));
    }
    const previous = viewport.current;
    if (previous?.marketId === marketId && previous.range) chart.timeScale().setVisibleLogicalRange(previous.range);
    else chart.timeScale().fitContent();
    return () => {
      viewport.current = { marketId, range: chart.timeScale().getVisibleLogicalRange() };
      chart.remove();
    };
  }, [bars, mode, marketId]);

  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#070c0e]">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-xs text-zinc-400">CoinAPI · one-minute candles · New York time</p>
      <div className="flex gap-1" aria-label="Chart display">
        {(["candles", "line"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
          onClick={() => setMode(value)} className={`rounded-lg px-3 py-2 text-xs capitalize ${mode === value ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-400"}`}>{value}</button>)}
      </div>
    </div>
    <div ref={container} className="h-[280px] w-full min-w-0" />
    <p className="px-4 py-2 text-[11px] text-zinc-500">Drag to inspect · pinch to zoom. Latest candle volume may be provisional.</p>
  </section>;
}
