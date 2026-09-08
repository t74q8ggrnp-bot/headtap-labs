"use client";
import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";
import { formatMarketPrice } from "@/lib/market-price-format";

export default function LiveCryptoValue({ symbol, productId, field = "price" }: { symbol: string; productId: string; field?: "price" | "change" }) {
  const view = useLiveMarketView(symbol, { asset: "crypto", productId });
  const change = view.quote?.changePercent;
  return <span data-market-symbol={symbol} data-market-price={view.quote?.price ?? ""} data-market-as-of={view.quote?.asOf ?? ""}
    title={view.quote ? `${view.label} · ${view.quote.source.startsWith("coinbase") ? "Coinbase USD · Massive pair unavailable" : "Massive crypto"} · ${view.quote.asOf}` : "Awaiting verified USD pair"}
    style={field === "change" && change != null ? { color: change >= 0 ? "#4ade80" : "#f87171" } : undefined}>
    {field === "price" ? formatMarketPrice(view.quote?.price) : change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
  </span>;
}
