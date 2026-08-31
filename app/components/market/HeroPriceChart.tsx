"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  TickMarkType,
  createChart,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  MarketChartAsset,
  MarketChartResponse,
} from "@/lib/market-chart";
import { HT_REFRESH_RATES_MS } from "@/lib/runtime-capabilities";

type HeroPriceChartProps = {
  asset: MarketChartAsset;
  symbol: string;
  productId?: string;
  accent?: "violet" | "orange" | "cyan";
  compact?: boolean;
  height?: number;
};

type ChartMode = "graph" | "candles";

const REQUEST_CACHE_MS = 2_000;
const STOCK_CHART_REFRESH_MS = HT_REFRESH_RATES_MS.selectedStockCharts;
const CRYPTO_CHART_REFRESH_MS = 60_000;
const requestCache = new Map<
  string,
  { createdAt: number; request: Promise<MarketChartResponse> }
>();

const accents = {
  violet: {
    line: "#a78bfa",
    border: "border-violet-400/15",
    text: "text-violet-300",
  },
  orange: {
    line: "#fb923c",
    border: "border-orange-400/15",
    text: "text-orange-300",
  },
  cyan: {
    line: "#22d3ee",
    border: "border-cyan-400/15",
    text: "text-cyan-300",
  },
} as const;

function loadChart(url: string) {
  const cached = requestCache.get(url);
  if (cached && Date.now() - cached.createdAt < REQUEST_CACHE_MS) {
    return cached.request;
  }

  const request = fetch(url, { cache: "no-store" }).then(async (response) => {
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      (payload as { success?: unknown }).success !== true
    ) {
      throw new Error("Verified chart unavailable.");
    }
    return payload as MarketChartResponse;
  }).catch((error) => {
    requestCache.delete(url);
    throw error;
  });
  requestCache.set(url, { createdAt: Date.now(), request });
  return request;
}

function formatPrice(value: number) {
  const maximumFractionDigits = value < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function chartTimeToDate(time: Time) {
  if (typeof time === "number") return new Date(time * 1_000);
  if (typeof time === "string") return new Date(`${time}T00:00:00.000Z`);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

function formatChartTick(
  time: Time,
  tickMarkType: TickMarkType,
  locale: string,
  timeZone: string,
) {
  const date = chartTimeToDate(time);
  if (tickMarkType <= TickMarkType.DayOfMonth) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone,
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export default function HeroPriceChart({
  asset,
  symbol,
  productId,
  accent = "violet",
  compact = false,
  height,
}: HeroPriceChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [result, setResult] = useState<{
    url: string;
    data: MarketChartResponse | null;
    failed: boolean;
  } | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
  );
  const palette = accents[accent];
  const url = useMemo(() => {
    const params = new URLSearchParams({ asset, symbol });
    if (productId) params.set("productId", productId);
    return `/api/market-chart?${params.toString()}`;
  }, [asset, productId, symbol]);
  const data = result?.url === url ? result.data : null;
  const failed = result?.url === url ? result.failed : false;

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadChart(url)
        .then((payload) => {
          if (active) setResult({ url, data: payload, failed: false });
        })
        .catch(() => {
          if (active) setResult({ url, data: null, failed: true });
        });
    };
    refresh();
    const refreshInterval = window.setInterval(
      refresh,
      asset === "stock" ? STOCK_CHART_REFRESH_MS : CRYPTO_CHART_REFRESH_MS,
    );
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [asset, url]);

  useEffect(() => {
    if (!chartRef.current || !data) return;

    const container = chartRef.current;
    const locale = navigator.language || "en-US";
    const chartTimeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
    const chart = createChart(container, {
      width: container.clientWidth,
      height: height ?? (compact ? 150 : 185),
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
          formatChartTick(time, tickMarkType, locale, timeZone),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        mouse: true,
        touch: true,
      },
      localization: {
        locale,
        priceFormatter: (price: number) => formatPrice(price),
        timeFormatter: (time: Time) =>
          chartTimeFormatter.format(chartTimeToDate(time)),
      },
    });

    if (chartMode === "candles") {
      const priceSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: true,
        borderUpColor: "#4ade80",
        borderDownColor: "#f87171",
        wickVisible: true,
        wickUpColor: "#86efac",
        wickDownColor: "#fca5a5",
        priceLineVisible: true,
        priceLineColor: `${palette.line}66`,
        lastValueVisible: true,
      });
      priceSeries.setData(
        data.bars.map((bar) => ({
          time: bar.time as UTCTimestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })),
      );
    } else {
      const priceSeries = chart.addSeries(AreaSeries, {
        lineColor: palette.line,
        topColor: `${palette.line}38`,
        bottomColor: `${palette.line}00`,
        lineWidth: 2,
        priceLineVisible: true,
        priceLineColor: `${palette.line}66`,
        lastValueVisible: true,
      });
      priceSeries.setData(
        data.bars.map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.close,
        })),
      );
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    volumeSeries.setData(
      data.bars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        value: bar.volume,
        color: bar.close >= bar.open
          ? "rgba(34, 197, 94, 0.28)"
          : "rgba(239, 68, 68, 0.24)",
      })),
    );
    const visibleBars = compact ? 90 : 180;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, data.bars.length - visibleBars),
      to: data.bars.length + 2,
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [chartMode, compact, data, height, palette, timeZone]);

  const resolvedHeight = height ?? (compact ? 150 : 185);

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
      className={`overflow-hidden rounded-2xl border ${palette.border} bg-black/35`}
      aria-label={`${symbol} verified price chart`}
    >
      <div className={`border-b border-white/7 px-3 py-2.5 ${compact ? "space-y-2.5 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0" : "flex flex-wrap items-center justify-between gap-2"}`}>
        <div className={compact ? "flex items-start justify-between gap-3" : ""}>
          <div>
            <p className={`text-[8px] font-black uppercase tracking-[0.2em] ${palette.text}`}>
              Verified price history
            </p>
            <p className="mt-0.5 text-[8px] font-semibold text-zinc-700">
              {data
                ? `${data.windowLabel} · ${data.sourceLabel} · ${chartMode === "candles" ? "OHLC" : "close graph"}`
                : "Provider-backed market history"}
            </p>
          </div>
          {compact && latestTime && (
            <p className="shrink-0 font-mono text-[8px] font-bold text-zinc-600">
              Through {latestTime}
            </p>
          )}
        </div>
        <div className={`flex items-center gap-2 ${compact ? "w-full sm:w-auto" : ""}`}>
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
              Through {latestTime}
            </p>
          )}
        </div>
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
          <div ref={chartRef} className="w-full" />
          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-white/7 px-3 py-1.5">
            <p className="text-[7px] font-semibold text-zinc-700">
              {chartMode === "candles"
                ? "Candles show open, high, low + close · drag to inspect"
                : "Graph connects verified closes · drag to inspect"}
            </p>
            <p className="font-mono text-[7px] font-bold uppercase text-zinc-700">
              Times shown {timeZoneLabel}
            </p>
          </div>
          <div className="grid grid-cols-4 border-t border-white/7">
            {[
              ["Open", formatPrice(data.summary.open)],
              ["High", formatPrice(data.summary.high)],
              ["Low", formatPrice(data.summary.low)],
              ["Chart move", `${data.summary.changePercent >= 0 ? "+" : ""}${data.summary.changePercent.toFixed(1)}%`],
            ].map(([label, value]) => (
              <div key={label} className="border-r border-white/7 px-2 py-2.5 last:border-r-0">
                <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-700">{label}</p>
                <p className={`mt-1 truncate font-mono text-[10px] font-black ${label === "Chart move" ? (data.summary.changePercent >= 0 ? "text-green-400" : "text-red-400") : "text-zinc-300"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
