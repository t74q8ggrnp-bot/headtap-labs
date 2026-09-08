"use client";

import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";
import { formatMarketPrice } from "@/lib/market-price-format";

/** Display only: never mutate the canonical opportunity or its ranking. */
export default function LiveStockValue({ symbol, field = "price", fallback, digits = 2 }: {
  symbol: string; field?: "price" | "change" | "time"; fallback?: number; digits?: number;
}) {
  const view = useLiveMarketView(symbol);
  const value = field === "price" ? view.quote?.price : view.quote?.changePercent;
  const shown = value ?? fallback;
  const text = field === "time" ? view.label : shown == null || !Number.isFinite(shown) ? "—" :
    field === "price" ? formatMarketPrice(shown) : `${shown >= 0 ? "+" : ""}${shown.toFixed(digits)}%`;
  return <span data-market-symbol={symbol} data-market-price={view.quote?.price ?? ""}
    data-market-as-of={view.quote?.asOf ?? ""} title={view.quote ? `${view.label} · ${view.quote.asOf}` : "Last decision snapshot; awaiting live quote"}
    style={field === "change" && shown != null ? { color: shown >= 0 ? "#4ade80" : "#f87171" } : undefined}>{text}</span>;
}
