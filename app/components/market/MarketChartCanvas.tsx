"use client";

import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  createChart,
  type AreaData,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type LineData,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import {
  type MarketChartBar,
  type MarketChartTimeSlot,
} from "@/lib/market-chart";
import {
  buildMarketChartRenderFrame,
  getIncrementalMarketChartStart,
  resolveMarketChartPriceResolution,
  type MarketChartIndicatorKey,
  type MarketChartIndicatorOverlays,
  type MarketChartIndicatorSlot,
  type MarketChartRenderFrame,
} from "@/lib/market-chart-rendering";
import { formatMarketPrice } from "@/lib/market-price-format";

export type { MarketChartIndicatorOverlays } from "@/lib/market-chart-rendering";

export type MarketChartMode = "graph" | "candles";
export type MarketChartAccent = "violet" | "orange" | "cyan";

export type ChartLayerAuthority = "user" | "prox" | "agent" | "auto";
export type ChartLayerSlots = Partial<Record<ChartLayerAuthority, ReactNode>>;

export type MarketChartCanvasProps = {
  bars: readonly MarketChartBar[];
  intervalSeconds: number;
  mode: MarketChartMode;
  accent?: MarketChartAccent;
  height: number;
  compact?: boolean;
  timeZone?: string;
  viewportKey?: string;
  indicators?: MarketChartIndicatorOverlays;
  layerHost?: ChartLayerSlots;
  /** @deprecated Prefer layerHost. Kept as a compatibility alias. */
  layerSlots?: ChartLayerSlots;
  className?: string;
};

export const MARKET_CHART_ACCENTS = {
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

export const CHART_LAYER_AUTHORITIES = [
  "user",
  "prox",
  "agent",
  "auto",
] as const satisfies readonly ChartLayerAuthority[];

/**
 * Stable overlay seam for future User, ProX, Agent, and automatic layers.
 * Phase 1 intentionally mounts no drawings, but callers can already provide
 * independently owned React overlays without changing the chart canvas.
 */
export function ChartLayerHost({ slots }: { slots?: ChartLayerSlots }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-chart-layer-host="true"
    >
      {CHART_LAYER_AUTHORITIES.map((authority) => (
        <div
          key={authority}
          className="pointer-events-none absolute inset-0"
          data-chart-layer-authority={authority}
        >
          {slots?.[authority]}
        </div>
      ))}
    </div>
  );
}

type PriceWriter = {
  setData: (slots: readonly MarketChartTimeSlot[]) => void;
  update: (slot: MarketChartTimeSlot) => void;
};

type VolumeWriter = {
  setData: (slots: readonly MarketChartTimeSlot[]) => void;
  update: (slot: MarketChartTimeSlot) => void;
};

type IndicatorWriter = {
  setData: (slots: readonly MarketChartIndicatorSlot[]) => void;
  update: (slot: MarketChartIndicatorSlot) => void;
};

type SavedViewport = {
  key: string;
  pointCount: number;
  range: { from: number; to: number };
};

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

function candlestickDatum(
  slot: MarketChartTimeSlot,
): CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp> {
  return slot.bar
    ? {
        time: slot.time as UTCTimestamp,
        open: slot.bar.open,
        high: slot.bar.high,
        low: slot.bar.low,
        close: slot.bar.close,
      }
    : { time: slot.time as UTCTimestamp };
}

function areaDatum(
  slot: MarketChartTimeSlot,
): AreaData<UTCTimestamp> | WhitespaceData<UTCTimestamp> {
  return slot.bar
    ? { time: slot.time as UTCTimestamp, value: slot.bar.close }
    : { time: slot.time as UTCTimestamp };
}

function volumeDatum(
  slot: MarketChartTimeSlot,
): HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp> {
  return slot.bar
    ? {
        time: slot.time as UTCTimestamp,
        value: slot.bar.volume,
        color: slot.bar.close >= slot.bar.open
          ? "rgba(34, 197, 94, 0.28)"
          : "rgba(239, 68, 68, 0.24)",
      }
    : { time: slot.time as UTCTimestamp };
}

function indicatorDatum(
  slot: MarketChartIndicatorSlot,
): LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp> {
  return slot.value === null
    ? { time: slot.time as UTCTimestamp }
    : { time: slot.time as UTCTimestamp, value: slot.value };
}

function setDefaultVisibleRange(input: {
  chart: IChartApi;
  compact: boolean;
  intervalSeconds: number;
  pointCount: number;
}) {
  const visibleMinutes = input.compact ? 90 : 180;
  const intervalMinutes = input.intervalSeconds / 60;
  const visiblePoints = Math.max(
    1,
    Math.floor(visibleMinutes / Math.max(intervalMinutes, 1 / 60)),
  );
  const to = input.pointCount + 2;
  input.chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, to - visiblePoints),
    to,
  });
}

export function MarketChartCanvas({
  bars,
  intervalSeconds,
  mode,
  accent = "violet",
  height,
  compact = false,
  timeZone,
  viewportKey = "market-chart",
  indicators,
  layerHost,
  layerSlots,
  className = "",
}: MarketChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceWriterRef = useRef<PriceWriter | null>(null);
  const volumeWriterRef = useRef<VolumeWriter | null>(null);
  const indicatorWritersRef = useRef(
    new Map<MarketChartIndicatorKey, IndicatorWriter>(),
  );
  const previousFrameRef = useRef<MarketChartRenderFrame | null>(null);
  const savedViewportRef = useRef<SavedViewport | null>(null);
  const slotCountRef = useRef(0);
  const palette = MARKET_CHART_ACCENTS[accent];
  const resolvedTimeZone = timeZone || "America/New_York";
  const resolvedIntervalSeconds = Number.isFinite(intervalSeconds) && intervalSeconds > 0
    ? intervalSeconds
    : 60;
  const resolvedViewportKey = `${viewportKey}:${compact ? "compact" : "full"}:${height}`;
  const showVwap = Boolean(indicators?.vwap);
  const showEma9 = Boolean(indicators?.ema9);
  const showEma20 = Boolean(indicators?.ema20);
  const frame = useMemo(() => buildMarketChartRenderFrame({
    bars,
    intervalSeconds: resolvedIntervalSeconds,
    indicators,
  }), [bars, indicators, resolvedIntervalSeconds]);
  const priceResolution = useMemo(
    () => resolveMarketChartPriceResolution(bars),
    [bars],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const locale = navigator.language || "en-US";
    const chartTimeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: resolvedTimeZone,
    });
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
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
        tickMarkFormatter: (chartTime: Time, tickMarkType: TickMarkType) =>
          formatChartTick(
            chartTime,
            tickMarkType,
            locale,
            resolvedTimeZone,
          ),
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
        priceFormatter: (price: number) => formatMarketPrice(price),
        timeFormatter: (chartTime: Time) =>
          chartTimeFormatter.format(chartTimeToDate(chartTime)),
      },
    });

    let priceWriter: PriceWriter;
    const priceFormat = {
      type: "custom" as const,
      formatter: (price: number) => formatMarketPrice(price),
      minMove: priceResolution.minMove,
    };
    if (mode === "candles") {
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
        priceFormat,
      });
      priceWriter = {
        setData: (slots) => priceSeries.setData(slots.map(candlestickDatum)),
        update: (slot) => priceSeries.update(candlestickDatum(slot)),
      };
    } else {
      const priceSeries = chart.addSeries(AreaSeries, {
        lineColor: palette.line,
        topColor: `${palette.line}38`,
        bottomColor: `${palette.line}00`,
        lineWidth: 2,
        priceLineVisible: true,
        priceLineColor: `${palette.line}66`,
        lastValueVisible: true,
        priceFormat,
      });
      priceWriter = {
        setData: (slots) => priceSeries.setData(slots.map(areaDatum)),
        update: (slot) => priceSeries.update(areaDatum(slot)),
      };
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
    const volumeWriter: VolumeWriter = {
      setData: (slots) => volumeSeries.setData(slots.map(volumeDatum)),
      update: (slot) => volumeSeries.update(volumeDatum(slot)),
    };

    const indicatorWriters = new Map<MarketChartIndicatorKey, IndicatorWriter>();
    const indicatorDefinitions = [
      { key: "vwap", enabled: showVwap, color: "#22d3ee", width: 2 },
      { key: "ema9", enabled: showEma9, color: "#fb923c", width: 1 },
      { key: "ema20", enabled: showEma20, color: "#a78bfa", width: 1 },
    ] as const;
    for (const definition of indicatorDefinitions) {
      if (!definition.enabled) continue;
      const series = chart.addSeries(LineSeries, {
        color: definition.color,
        lineWidth: definition.width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });
      indicatorWriters.set(definition.key, {
        setData: (slots) => series.setData(slots.map(indicatorDatum)),
        update: (slot) => series.update(indicatorDatum(slot)),
      });
    }

    chartRef.current = chart;
    priceWriterRef.current = priceWriter;
    volumeWriterRef.current = volumeWriter;
    indicatorWritersRef.current = indicatorWriters;
    previousFrameRef.current = null;

    const rememberViewport = (range: { from: number; to: number } | null) => {
      if (!range) return;
      savedViewportRef.current = {
        key: resolvedViewportKey,
        pointCount: slotCountRef.current,
        range,
      };
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rememberViewport);

    const resizeChart = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(resizeChart);
    if (resizeObserver) {
      resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", resizeChart);
    }

    return () => {
      rememberViewport(chart.timeScale().getVisibleLogicalRange());
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rememberViewport);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resizeChart);
      chartRef.current = null;
      priceWriterRef.current = null;
      volumeWriterRef.current = null;
      indicatorWritersRef.current = new Map();
      previousFrameRef.current = null;
      chart.remove();
    };
  }, [height, mode, palette.line, priceResolution.minMove, resolvedTimeZone, resolvedViewportKey, showEma20, showEma9, showVwap]);

  useEffect(() => {
    const chart = chartRef.current;
    const priceWriter = priceWriterRef.current;
    const volumeWriter = volumeWriterRef.current;
    if (!chart || !priceWriter || !volumeWriter) return;

    if (frame.slots.length === 0) {
      if (previousFrameRef.current?.slots.length) {
        priceWriter.setData([]);
        volumeWriter.setData([]);
        for (const writer of indicatorWritersRef.current.values()) {
          writer.setData([]);
        }
      }
      previousFrameRef.current = frame;
      slotCountRef.current = 0;
      return;
    }

    const previousFrame = previousFrameRef.current;
    const savedViewport = savedViewportRef.current?.key === resolvedViewportKey
      ? savedViewportRef.current
      : null;
    const previousRange = chart.timeScale().getVisibleLogicalRange() ??
      savedViewport?.range;
    const previousPointCount = previousFrame?.slots.length ??
      savedViewport?.pointCount ??
      0;
    const wasFollowingLatest = !previousRange || previousPointCount === 0 ||
      previousRange.to >= previousPointCount - 3;
    const incrementalStart = getIncrementalMarketChartStart(
      previousFrame,
      frame,
    );

    if (incrementalStart === null) {
      priceWriter.setData(frame.slots);
      volumeWriter.setData(frame.slots);
      for (const [key, writer] of indicatorWritersRef.current) {
        writer.setData(frame.indicators[key]);
      }
    } else {
      for (
        let index = incrementalStart;
        index < frame.slots.length;
        index += 1
      ) {
        priceWriter.update(frame.slots[index]);
        volumeWriter.update(frame.slots[index]);
        for (const [key, writer] of indicatorWritersRef.current) {
          const indicatorSlot = frame.indicators[key][index];
          if (indicatorSlot) writer.update(indicatorSlot);
        }
      }
    }

    slotCountRef.current = frame.slots.length;
    previousFrameRef.current = frame;

    if (previousRange && !wasFollowingLatest) {
      chart.timeScale().setVisibleLogicalRange(previousRange);
    } else {
      setDefaultVisibleRange({
        chart,
        compact,
        intervalSeconds: resolvedIntervalSeconds,
        pointCount: frame.slots.length,
      });
    }

    const range = chart.timeScale().getVisibleLogicalRange();
    if (range) {
      savedViewportRef.current = {
        key: resolvedViewportKey,
        pointCount: frame.slots.length,
        range,
      };
    }
  }, [compact, frame, mode, palette.line, resolvedIntervalSeconds, resolvedTimeZone, resolvedViewportKey, showEma20, showEma9, showVwap]);

  return (
    <div
      className={`relative w-full ${className}`.trim()}
      data-market-chart-canvas="true"
      data-chart-mode={mode}
      data-chart-interval-seconds={resolvedIntervalSeconds}
      style={{ height }}
    >
      <div ref={containerRef} className="h-full w-full" />
      <ChartLayerHost slots={layerHost ?? layerSlots} />
    </div>
  );
}

export default MarketChartCanvas;
