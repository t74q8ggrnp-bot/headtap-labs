"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarketChartCanvas, {
  type ChartLayerSlots,
  type MarketChartIndicatorOverlays,
  type MarketChartMode,
} from "@/app/components/market/MarketChartCanvas";
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

const EMPTY_LAYER_HOST: ChartLayerSlots = Object.freeze({});

const layerLabels = {
  volume: "Volume",
  vwap: "VWAP",
  ema9: "EMA 9",
  ema20: "EMA 20",
} as const;

type Layer = keyof typeof layerLabels;

const visibleRanges = [
  { id: "1h", label: "1H" },
  { id: "2h", label: "2H" },
  { id: "session", label: "Session" },
] as const satisfies ReadonlyArray<{ id: MarketChartVisibleRange; label: string }>;

export default function HomeReferenceChart({ symbol }: { symbol: string }) {
  const marketView = useLiveMarketView(symbol, { chart: true });
  const [timeframe, setTimeframe] = useState<MarketChartTimeframe>("1m");
  const [mode, setMode] = useState<MarketChartMode>("candles");
  const [height, setHeight] = useState(500);
  const [visibleRange, setVisibleRange] = useState<MarketChartVisibleRange>("2h");
  const [latestResetToken, setLatestResetToken] = useState(0);
  const rangeSelectedByUserRef = useRef(false);
  const chartLayers = useChartLayerPreferences();
  const layers = chartLayers.preferences;

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const terminalQuery = window.matchMedia("(min-width: 1180px)");
    const landscapeQuery = window.matchMedia("(min-width: 768px) and (max-width: 1179px) and (orientation: landscape)");
    const apply = () => {
      setHeight(
        landscapeQuery.matches
          ? Math.max(220, window.innerHeight - 150)
          : mobileQuery.matches
          ? window.innerHeight < 720
            ? Math.max(290, Math.round(window.innerHeight * 0.46))
            : Math.min(560, Math.max(300, window.innerHeight - 386))
          : terminalQuery.matches
            ? Math.max(620, window.innerHeight - 125)
            : 500,
      );
      if (!rangeSelectedByUserRef.current) {
        setVisibleRange(mobileQuery.matches ? "1h" : "2h");
      }
    };
    apply();
    mobileQuery.addEventListener("change", apply);
    terminalQuery.addEventListener("change", apply);
    landscapeQuery.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mobileQuery.removeEventListener("change", apply);
      terminalQuery.removeEventListener("change", apply);
      landscapeQuery.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

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

  const selectVisibleRange = (range: MarketChartVisibleRange) => {
    rangeSelectedByUserRef.current = true;
    setVisibleRange(range);
  };

  return (
    <section className="htb-chart" aria-label={`${symbol} verified market chart`}>
      {marketView.error && !marketView.chart ? (
        <div className="htb-chart__state" style={{ height }} role="status">
          <strong>Verified chart unavailable</strong>
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
            visibleRange={visibleRange}
            latestResetToken={latestResetToken}
          />
        </div>
      )}

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
        <button
          type="button"
          className="htb-chart__latest"
          aria-label="Latest / reset visible chart range"
          onClick={() => setLatestResetToken((current) => current + 1)}
        >
          Latest
        </button>
      </div>

      <div className="htb-chart__caption">
        <span>{marketView.chart?.sourceLabel ?? "Provider-backed market history"}</span>
        <span className="ht-tabular-numbers">{marketView.label}</span>
      </div>
    </section>
  );
}
