import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { marketWorkspaceHref, normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const symbol = normalizeMarketWorkspaceSymbol((await params).ticker);
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
  const symbol = normalizeMarketWorkspaceSymbol((await params).ticker);
  if (!symbol) notFound();
  redirect(marketWorkspaceHref(symbol)!);
}
