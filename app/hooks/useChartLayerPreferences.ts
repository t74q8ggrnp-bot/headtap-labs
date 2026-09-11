"use client";

import { useCallback, useEffect, useState } from "react";

export type ChartLayerPreferences = {
  agent: boolean;
  prox: boolean;
  vwap: boolean;
  ema9: boolean;
  ema20: boolean;
  volume: boolean;
};

const STORAGE_KEY = "ht-chart-layer-preferences-v1";
const DEFAULTS: ChartLayerPreferences = {
  agent: true,
  prox: true,
  vwap: false,
  ema9: false,
  ema20: false,
  volume: true,
};

export function useChartLayerPreferences() {
  const [preferences, setPreferences] = useState(DEFAULTS);
  useEffect(() => {
    let timer = 0;
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ChartLayerPreferences> | null;
      if (stored) timer = window.setTimeout(() => setPreferences({ ...DEFAULTS, ...stored }), 0);
    } catch {
      // Device-local preferences are optional and never block the chart.
    }
    return () => window.clearTimeout(timer);
  }, []);
  const toggle = useCallback((key: keyof ChartLayerPreferences) => {
    setPreferences((current) => {
      const next = { ...current, [key]: !current[key] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The selected state remains usable for the current tab.
      }
      return next;
    });
  }, []);
  return { preferences, toggle };
}
