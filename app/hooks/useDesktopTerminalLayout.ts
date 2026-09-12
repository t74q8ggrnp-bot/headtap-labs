"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DESKTOP_TERMINAL_PREFERENCES,
  DESKTOP_TERMINAL_STORAGE_KEY,
  normalizeDesktopTerminalPreferences,
  type DesktopTerminalPreferences,
  type TerminalPanePreference,
} from "@/lib/desktop-terminal-layout";

export function useDesktopTerminalLayout() {
  const [preferences, setPreferences] = useState<DesktopTerminalPreferences>(
    DEFAULT_DESKTOP_TERMINAL_PREFERENCES,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setPreferences(normalizeDesktopTerminalPreferences(JSON.parse(
          window.localStorage.getItem(DESKTOP_TERMINAL_STORAGE_KEY) ?? "null",
        )));
      } catch {
        setPreferences(DEFAULT_DESKTOP_TERMINAL_PREFERENCES);
      }
      setReady(true);
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === DESKTOP_TERMINAL_STORAGE_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(
        DESKTOP_TERMINAL_STORAGE_KEY,
        JSON.stringify(preferences),
      );
    } catch {
      // Layout persistence is optional; current-tab controls remain usable.
    }
  }, [preferences, ready]);

  const setPane = useCallback((
    pane: "markets" | "intelligence",
    value: TerminalPanePreference,
  ) => {
    setPreferences((current) => ({ ...current, [pane]: value }));
  }, []);

  const setPaneWidth = useCallback((
    pane: "markets" | "intelligence",
    value: number,
  ) => {
    const key = pane === "markets" ? "marketsWidth" : "intelligenceWidth";
    const minimum = pane === "markets" ? 210 : 280;
    const maximum = pane === "markets" ? 260 : 360;
    setPreferences((current) => ({
      ...current,
      [key]: Math.min(maximum, Math.max(minimum, Math.round(value))),
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setPreferences(DEFAULT_DESKTOP_TERMINAL_PREFERENCES);
  }, []);

  return useMemo(() => ({
    preferences,
    ready,
    setPane,
    setPaneWidth,
    resetLayout,
  }), [preferences, ready, resetLayout, setPane, setPaneWidth]);
}
