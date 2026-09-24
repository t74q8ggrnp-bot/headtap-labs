"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  parseTerminalPriceAlerts,
  priceAlertTriggered,
  TERMINAL_PRICE_ALERTS_KEY,
  type TerminalPriceAlert,
  type TerminalPriceAlertSource,
} from "@/lib/terminal-price-alerts";
import { normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";

const EVENT_NAME = "htlabs:terminal-price-alerts-updated";

function readAlerts() {
  try {
    return parseTerminalPriceAlerts(
      JSON.parse(window.localStorage.getItem(TERMINAL_PRICE_ALERTS_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

function writeAlerts(alerts: TerminalPriceAlert[]) {
  window.localStorage.setItem(TERMINAL_PRICE_ALERTS_KEY, JSON.stringify(alerts.slice(-100)));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function useTerminalPriceAlerts(symbolValue: string, currentPrice: number | null) {
  const symbol = normalizeMarketWorkspaceSymbol(symbolValue);
  const [alerts, setAlerts] = useState<TerminalPriceAlert[]>([]);

  useEffect(() => {
    const sync = () => setAlerts(readAlerts());
    const timer = window.setTimeout(sync, 0);
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT_NAME, sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT_NAME, sync);
    };
  }, []);

  useEffect(() => {
    if (!symbol || currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) return;
    const newlyTriggered = alerts.filter((alert) =>
      alert.symbol === symbol && alert.triggeredAt === null && priceAlertTriggered(alert, currentPrice));
    if (newlyTriggered.length === 0) return;
    const triggeredIds = new Set(newlyTriggered.map((alert) => alert.id));
    const triggeredAt = new Date().toISOString();
    const next = alerts.map((alert) => triggeredIds.has(alert.id) ? { ...alert, triggeredAt } : alert);
    try {
      writeAlerts(next);
    } catch {
      const timer = window.setTimeout(() => setAlerts(next), 0);
      return () => window.clearTimeout(timer);
    }
    window.dispatchEvent(new CustomEvent("htlabs:price-alert-triggered", {
      detail: { symbol, alerts: newlyTriggered, currentPrice },
    }));
  }, [alerts, currentPrice, symbol]);

  const addAlert = useCallback((input: {
    price: number;
    label: string;
    source: TerminalPriceAlertSource;
    direction?: TerminalPriceAlert["direction"];
  }) => {
    if (!symbol || !Number.isFinite(input.price) || input.price <= 0) return false;
    const current = readAlerts();
    const direction = input.direction ?? (
      currentPrice !== null && currentPrice > input.price ? "at_or_below" : "at_or_above"
    );
    const duplicate = current.some((alert) =>
      alert.symbol === symbol && alert.triggeredAt === null &&
      Math.abs(alert.price - input.price) < Math.max(0.000001, input.price * 0.000001));
    if (duplicate) return false;
    const next: TerminalPriceAlert[] = [...current, {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${symbol}-${Date.now()}`,
      symbol,
      price: input.price,
      direction,
      source: input.source,
      label: input.label,
      createdAt: new Date().toISOString(),
      triggeredAt: null,
    }];
    try {
      writeAlerts(next);
    } catch {
      setAlerts(next);
    }
    return true;
  }, [currentPrice, symbol]);

  const active = useMemo(
    () => alerts.filter((alert) => alert.symbol === symbol && alert.triggeredAt === null),
    [alerts, symbol],
  );
  const latestTriggered = useMemo(
    () => alerts.filter((alert) => alert.symbol === symbol && alert.triggeredAt !== null).at(-1) ?? null,
    [alerts, symbol],
  );

  return { active, latestTriggered, addAlert };
}
