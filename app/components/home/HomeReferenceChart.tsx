"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarketChartCanvas, {
  type ChartLayerSlots,
  type MarketChartIndicatorOverlays,
  type MarketChartMode,
} from "@/app/components/market/MarketChartCanvas";
import type {
  MarketChartUserDrawing,
  MarketChartUserDrawingTool,
} from "@/app/components/market/MarketChartUserDrawings";
import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";
import { useChartLayerPreferences } from "@/app/hooks/useChartLayerPreferences";
import { calculateMarketIndicators } from "@/lib/market-indicators";
import {
  deriveMarketChartTimeframeBars,
  getMarketChartTimeframeMetadata,
  PHASE_ONE_MARKET_CHART_TIMEFRAMES,
  type MarketChartTimeframe,
} from "@/lib/market-chart-timeframes";
import type { MarketChartVisibleRange } from "@/lib/market-chart-visible-range";
import {
  marketChartCoverageIsSparse,
  type MarketChartVisibleCoverage,
} from "@/lib/market-chart-rendering";

const EMPTY_LAYER_HOST: ChartLayerSlots = Object.freeze({});

const layerLabels = {
  volume: "Volume",
  vwap: "VWAP",
  ema9: "EMA 9",
  ema20: "EMA 20",
} as const;

type Layer = keyof typeof layerLabels;

const standardVisibleRanges = [
  { id: "1h", label: "1H" },
  { id: "2h", label: "2H" },
  { id: "session", label: "Session" },
] as const satisfies ReadonlyArray<{ id: MarketChartVisibleRange; label: string }>;

const spotMomentumVisibleRanges = [
  { id: "1h", label: "1H" },
  { id: "90m", label: "90M" },
  { id: "2h", label: "2H" },
  { id: "session", label: "Session" },
] as const satisfies ReadonlyArray<{ id: MarketChartVisibleRange; label: string }>;

type DrawingHistory = {
  past: MarketChartUserDrawing[][];
  present: MarketChartUserDrawing[];
  future: MarketChartUserDrawing[][];
};

const EMPTY_DRAWING_HISTORY: DrawingHistory = { past: [], present: [], future: [] };

const DRAWING_TOOLS = [
  { id: "pan", label: "Pan chart", shortLabel: "Pan", glyph: "↔" },
  { id: "select", label: "Select and move drawing", shortLabel: "Select", glyph: "↖" },
  { id: "horizontal", label: "Draw horizontal level", shortLabel: "Horizontal", glyph: "—" },
  { id: "trend", label: "Draw trendline", shortLabel: "Trendline", glyph: "╱" },
  { id: "measure", label: "Measure price range", shortLabel: "Price range", glyph: "↕" },
] as const satisfies ReadonlyArray<{
  id: MarketChartUserDrawingTool;
  label: string;
  shortLabel: string;
  glyph: string;
}>;

function validStoredDrawings(value: unknown): MarketChartUserDrawing[] {
  if (!Array.isArray(value)) return [];
  return value.filter((drawing): drawing is MarketChartUserDrawing => {
    if (!drawing || typeof drawing !== "object") return false;
    const candidate = drawing as MarketChartUserDrawing;
    return typeof candidate.id === "string" &&
      ["horizontal", "trend", "measure"].includes(candidate.kind) &&
      Array.isArray(candidate.points) &&
      candidate.points.length >= 1 &&
      candidate.points.every((point) => Number.isFinite(point?.time) && Number.isFinite(point?.price));
  });
}

export default function HomeReferenceChart({
  symbol,
  presentation = "market",
}: {
  symbol: string;
  presentation?: "market" | "spot-momentum";
}) {
  const marketView = useLiveMarketView(symbol, { chart: true });
  const defaultVisibleRange: MarketChartVisibleRange = presentation === "spot-momentum" ? "90m" : "2h";
  const visibleRanges = presentation === "spot-momentum" ? spotMomentumVisibleRanges : standardVisibleRanges;
  const [timeframe, setTimeframe] = useState<MarketChartTimeframe>("1m");
  const [mode, setMode] = useState<MarketChartMode>("candles");
  const [height, setHeight] = useState(500);
  const [visibleRange, setVisibleRange] = useState<MarketChartVisibleRange>(defaultVisibleRange);
  const [latestResetToken, setLatestResetToken] = useState(0);
  const [visibleCoverage, setVisibleCoverage] = useState<MarketChartVisibleCoverage | null>(null);
  const [drawingHistory, setDrawingHistory] = useState<DrawingHistory>(EMPTY_DRAWING_HISTORY);
  const [drawingTool, setDrawingTool] = useState<MarketChartUserDrawingTool>("pan");
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawPaletteOpen, setDrawPaletteOpen] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const rangeInitializedRef = useRef(false);
  const loadedDrawingSymbolRef = useRef<string | null>(null);
  const drawMenuRef = useRef<HTMLDetailsElement | null>(null);
  const chartLayers = useChartLayerPreferences();
  const layers = chartLayers.preferences;

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const terminalQuery = window.matchMedia("(min-width: 1180px)");
    const landscapeQuery = window.matchMedia("(min-width: 768px) and (max-width: 1179px) and (orientation: landscape)");
    const apply = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      setHeight(
        landscapeQuery.matches
          ? Math.max(180, viewportHeight - 164)
          : mobileQuery.matches
          ? Math.min(620, Math.max(330, viewportHeight - 302))
          : terminalQuery.matches
            ? Math.max(620, viewportHeight - 125)
            : 500,
      );
      if (!rangeInitializedRef.current) {
        setVisibleRange(mobileQuery.matches ? "1h" : defaultVisibleRange);
        rangeInitializedRef.current = true;
      }
    };
    apply();
    mobileQuery.addEventListener("change", apply);
    terminalQuery.addEventListener("change", apply);
    landscapeQuery.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      mobileQuery.removeEventListener("change", apply);
      terminalQuery.removeEventListener("change", apply);
      landscapeQuery.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, [defaultVisibleRange]);

  useEffect(() => {
    const storageKey = `htlabs:user-drawings:v1:${symbol}`;
    let drawings: MarketChartUserDrawing[] = [];
    try {
      drawings = validStoredDrawings(JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"));
    } catch {
      drawings = [];
    }
    loadedDrawingSymbolRef.current = symbol;
    const syncTimer = window.setTimeout(() => {
      setDrawingHistory({ past: [], present: drawings, future: [] });
      setSelectedDrawingId(null);
      setDrawingTool("pan");
      setDrawPaletteOpen(false);
      setDrawingsVisible(true);
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, [symbol]);

  useEffect(() => {
    if (loadedDrawingSymbolRef.current !== symbol) return;
    window.localStorage.setItem(
      `htlabs:user-drawings:v1:${symbol}`,
      JSON.stringify(drawingHistory.present),
    );
  }, [drawingHistory.present, symbol]);

  const baseBars = useMemo(() => marketView.chart?.bars ?? [], [marketView.chart]);
  const bars = useMemo(
    () => deriveMarketChartTimeframeBars(baseBars, timeframe),
    [baseBars, timeframe],
  );
  const calculated = useMemo(
    () => calculateMarketIndicators(bars, { vwapResetMode: "eastern_date", precision: 8 }),
    [bars],
  );
  const indicators = useMemo<MarketChartIndicatorOverlays>(() => ({
    ...(layers.vwap ? { vwap: calculated.vwap } : {}),
    ...(layers.ema9 ? { ema9: calculated.ema9 } : {}),
    ...(layers.ema20 ? { ema20: calculated.ema20 } : {}),
  }), [calculated, layers.ema20, layers.ema9, layers.vwap]);
  const intervalSeconds = getMarketChartTimeframeMetadata(timeframe).intervalSeconds;
  const handleVisibleCoverageChange = useCallback(
    (coverage: MarketChartVisibleCoverage | null) => {
      setVisibleCoverage((current) => (
        current?.expectedIntervalCount === coverage?.expectedIntervalCount &&
          current?.renderedProviderBarCount === coverage?.renderedProviderBarCount &&
          current?.coveragePercentage === coverage?.coveragePercentage
          ? current
          : coverage
      ));
    },
    [],
  );
  const sparseCoverage = timeframe === "1m" &&
    visibleCoverage &&
    marketChartCoverageIsSparse(visibleCoverage)
    ? visibleCoverage
    : null;

  const selectVisibleRange = (range: MarketChartVisibleRange) => {
    setVisibleRange(range);
  };

  const commitDrawings = useCallback((next: MarketChartUserDrawing[]) => {
    setDrawingHistory((current) => ({
      past: [...current.past, current.present].slice(-50),
      present: next,
      future: [],
    }));
  }, []);

  const undoDrawing = useCallback(() => {
    setDrawingHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, 50),
      };
    });
    setSelectedDrawingId(null);
  }, []);

  const redoDrawing = useCallback(() => {
    setDrawingHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present].slice(-50),
        present: next,
        future: current.future.slice(1),
      };
    });
    setSelectedDrawingId(null);
  }, []);

  const deleteDrawing = useCallback((id: string) => {
    setDrawingHistory((current) => {
      const next = current.present.filter((drawing) => drawing.id !== id);
      if (next.length === current.present.length) return current;
      return {
        past: [...current.past, current.present].slice(-50),
        present: next,
        future: [],
      };
    });
    setSelectedDrawingId((current) => current === id ? null : current);
  }, []);

  const deleteSelectedDrawing = useCallback(() => {
    if (selectedDrawingId) deleteDrawing(selectedDrawingId);
  }, [deleteDrawing, selectedDrawingId]);

  const chooseDrawingTool = useCallback((tool: MarketChartUserDrawingTool) => {
    setDrawingTool(tool);
    drawMenuRef.current?.removeAttribute("open");
    setDrawPaletteOpen(tool !== "pan");
  }, []);

  const toggleDrawingsVisible = useCallback(() => {
    if (drawingsVisible) setSelectedDrawingId(null);
    setDrawingsVisible((current) => !current);
  }, [drawingsVisible]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoDrawing();
        else undoDrawing();
        return;
      }
      if (event.key === "Escape") {
        setDrawingTool("pan");
        setSelectedDrawingId(null);
        setDrawPaletteOpen(false);
        drawMenuRef.current?.removeAttribute("open");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDrawingId) {
        event.preventDefault();
        deleteDrawing(selectedDrawingId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteDrawing, redoDrawing, selectedDrawingId, undoDrawing]);

  return (
    <section
      className="htb-chart"
      aria-label={`${symbol} verified market chart`}
      data-chart-symbol={symbol}
      data-chart-coverage-percent={visibleCoverage?.coveragePercentage}
      data-chart-expected-intervals={visibleCoverage?.expectedIntervalCount}
      data-chart-rendered-bars={visibleCoverage?.renderedProviderBarCount}
    >
      {marketView.error && !marketView.chart ? (
        <div className="htb-chart__state" style={{ height }} role="status">
          <strong>Data unavailable for {symbol}</strong>
          <span>No estimated candles are shown.</span>
        </div>
      ) : bars.length === 0 ? (
        <div className="htb-chart__state" style={{ height }} role="status" aria-live="polite">
          <strong>Loading verified chart</strong>
          <span>Connecting to the existing provider-backed frame.</span>
        </div>
      ) : (
        <div data-chart-timeframe={timeframe} data-chart-provider-requests-on-switch="0" data-chart-range-provider-requests-on-switch="0">
          <MarketChartCanvas
            bars={bars}
            intervalSeconds={intervalSeconds}
            mode={mode}
            accent="orange"
            height={height}
            compact={height < 400}
            timeZone="America/New_York"
            viewportKey={`home-reference:${symbol}:${timeframe}`}
            indicators={indicators}
            showVolume={layers.volume}
            layerHost={EMPTY_LAYER_HOST}
            preserveEngineOnLocalControls
            candlePresentation={presentation === "spot-momentum" ? "refined" : "standard"}
            visibleRange={visibleRange}
            latestResetToken={latestResetToken}
            onVisibleCoverageChange={handleVisibleCoverageChange}
            userDrawings={drawingsVisible ? drawingHistory.present : []}
            userDrawingTool={drawingTool}
            selectedUserDrawingId={selectedDrawingId}
            onSelectUserDrawing={setSelectedDrawingId}
            onCommitUserDrawings={commitDrawings}
            onDeleteUserDrawing={deleteDrawing}
            onUserDrawingToolComplete={() => setDrawingTool("select")}
          />
        </div>
      )}

      {drawPaletteOpen ? (
        <div className="htb-chart__drawing-rail" role="toolbar" aria-label="Chart drawing tools">
          {DRAWING_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              aria-label={tool.label}
              title={tool.label}
              aria-pressed={drawingTool === tool.id}
              onClick={() => chooseDrawingTool(tool.id)}
            >
              <span aria-hidden="true">{tool.glyph}</span>
              <span className="sr-only">{tool.shortLabel}</span>
            </button>
          ))}
          <span className="htb-chart__drawing-rail-separator" aria-hidden="true" />
          <button
            type="button"
            aria-label={drawingsVisible ? "Hide saved drawings" : "Show saved drawings"}
            title={drawingsVisible ? "Hide saved drawings" : "Show saved drawings"}
            aria-pressed={!drawingsVisible}
            onClick={toggleDrawingsVisible}
          >
            <span aria-hidden="true">{drawingsVisible ? "◉" : "○"}</span>
          </button>
          <button type="button" aria-label="Undo drawing" title="Undo drawing" disabled={drawingHistory.past.length === 0} onClick={undoDrawing}>↶</button>
          <button type="button" aria-label="Redo drawing" title="Redo drawing" disabled={drawingHistory.future.length === 0} onClick={redoDrawing}>↷</button>
          <button type="button" aria-label="Delete selected drawing" title="Delete selected drawing" disabled={!selectedDrawingId} onClick={deleteSelectedDrawing}>⌫</button>
          <button
            type="button"
            className="htb-chart__drawing-rail-done"
            aria-label="Close drawing tools and return to chart pan"
            title="Done drawing"
            onClick={() => {
              setDrawingTool("pan");
              setSelectedDrawingId(null);
              setDrawPaletteOpen(false);
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {visibleCoverage ? (
        <output className="sr-only" aria-label="Visible chart coverage">
          {visibleCoverage.renderedProviderBarCount} of {visibleCoverage.expectedIntervalCount} intervals contain verified provider bars · {visibleCoverage.coveragePercentage}% coverage
        </output>
      ) : null}

      <div className="htb-chart__toolbar">
        <div className="htb-chart__controls" role="group" aria-label="Chart timeframe">
          {PHASE_ONE_MARKET_CHART_TIMEFRAMES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={timeframe === option.id}
              onClick={() => setTimeframe(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="htb-chart__toolbar-separator" aria-hidden="true" />
        <label className="htb-chart__range">
          <span>Range</span>
          <select
            aria-label="Visible chart range"
            value={visibleRange}
            onChange={(event) => selectVisibleRange(event.target.value as MarketChartVisibleRange)}
          >
            {visibleRanges.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <details className="htb-chart__layers-menu">
          <summary>Layers</summary>
          <div className="htb-chart__layers-panel">
            <div className="htb-chart__layers-mode" role="group" aria-label="Chart style">
              {(["candles", "graph"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                >
                  {option === "candles" ? "Candles" : "Line"}
                </button>
              ))}
            </div>
            <div className="htb-chart__layers" role="group" aria-label="Chart layers">
              {(Object.keys(layerLabels) as Layer[]).map((layer) => (
                <button
                  key={layer}
                  type="button"
                  aria-pressed={layers[layer]}
                  data-layer={layer}
                  onClick={() => chartLayers.toggle(layer)}
                >
                  {layer !== "volume" ? <span className={`ht-chart-layer-key ht-chart-layer-key--${layer}`} aria-hidden="true" /> : null}
                  {layerLabels[layer]}
                </button>
              ))}
            </div>
          </div>
        </details>
        <details
          ref={drawMenuRef}
          className="htb-chart__draw-menu"
          onToggle={(event) => {
            if (event.currentTarget.open) setDrawPaletteOpen(true);
          }}
        >
          <summary aria-label={`Drawing tools${drawingHistory.present.length ? `, ${drawingHistory.present.length} saved` : ""}`}>Draw</summary>
          <div className="htb-chart__draw-panel">
            <div role="group" aria-label="Drawing mode">
              {DRAWING_TOOLS.map((tool) => (
                <button key={tool.id} type="button" aria-pressed={drawingTool === tool.id} onClick={() => chooseDrawingTool(tool.id)}>{tool.shortLabel}</button>
              ))}
            </div>
            <div className="htb-chart__draw-history" role="group" aria-label="Drawing history">
              <button type="button" disabled={drawingHistory.past.length === 0} onClick={undoDrawing}>Undo</button>
              <button type="button" disabled={drawingHistory.future.length === 0} onClick={redoDrawing}>Redo</button>
              <button type="button" disabled={!selectedDrawingId} onClick={deleteSelectedDrawing}>Delete selected</button>
              <button type="button" aria-pressed={!drawingsVisible} onClick={toggleDrawingsVisible}>{drawingsVisible ? "Hide drawings" : "Show drawings"}</button>
            </div>
            <p>{drawingHistory.present.length} saved on this device for {symbol}.</p>
          </div>
        </details>
        <button
          type="button"
          className="htb-chart__latest"
          aria-label="Latest / reset visible chart range"
          onClick={() => setLatestResetToken((current) => current + 1)}
        >
          Latest
        </button>
      </div>

      {sparseCoverage ? (
        <details
          className="htb-chart__sparse-status"
          aria-label="Sparse chart coverage"
          data-chart-coverage-percent={sparseCoverage.coveragePercentage}
          data-chart-expected-intervals={sparseCoverage.expectedIntervalCount}
          data-chart-rendered-bars={sparseCoverage.renderedProviderBarCount}
        >
          <summary role="status" aria-live="polite">
            Sparse tape · {sparseCoverage.renderedProviderBarCount} of {sparseCoverage.expectedIntervalCount} minutes traded <span aria-hidden="true">ⓘ</span>
          </summary>
          <div className="htb-chart__sparse-detail">
            <span>Blank intervals represent minutes with no verified provider aggregate.</span>
            <div className="htb-chart__sparse-actions" aria-label="Sparse chart alternatives">
              <button type="button" onClick={() => setTimeframe("5m")}>View 5m</button>
              <button type="button" onClick={() => selectVisibleRange("session")}>View session</button>
            </div>
          </div>
        </details>
      ) : null}

      <div className="htb-chart__caption">
        <span>{marketView.chart?.sourceLabel ?? "Provider-backed market history"}</span>
        <span className="ht-tabular-numbers">{marketView.label}</span>
      </div>
    </section>
  );
}
