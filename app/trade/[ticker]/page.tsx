import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TradeWorkspace from "@/app/components/trade/TradeWorkspace";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

function normalizeTicker(value: string) {
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const symbol = normalizeTicker((await params).ticker);
  return {
    title: symbol ? `${symbol} Trading Workspace | HT Labs` : "Trading Workspace | HT Labs",
    description: symbol
      ? `A live, provider-time-aligned research workspace for ${symbol}.`
      : "HT Labs universal stock and ETF research workspace.",
  };
}

export default async function TradeTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const symbol = normalizeTicker((await params).ticker);
  if (!symbol) notFound();

  return <TradeWorkspace symbol={symbol} />;
}
