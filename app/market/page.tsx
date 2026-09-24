import { Suspense } from "react";
import { notFound } from "next/navigation";
import HomeClient from "../HomeClient";
import { normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";
import TerminalRouteLoading from "@/app/components/ui/TerminalRouteLoading";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string | string[] }>;
}) {
  const rawTicker = (await searchParams).ticker;
  if (rawTicker !== undefined && (
    Array.isArray(rawTicker) || !normalizeMarketWorkspaceSymbol(rawTicker)
  )) {
    notFound();
  }
  return (
    <Suspense fallback={<TerminalRouteLoading label="Opening the market terminal" />}>
      <HomeClient
        surface="market"
        initialMomentumPayload={null}
        initialBeforeCrowdPayload={null}
      />
    </Suspense>
  );
}
