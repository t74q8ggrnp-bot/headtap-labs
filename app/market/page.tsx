import { Suspense } from "react";
import { notFound } from "next/navigation";
import HomeClient from "../HomeClient";
import { getRollingCanonicalDecisionFrame } from "@/lib/canonical-decision-frame";
import { compactHomeInitialOpportunityPayload } from "@/lib/home-initial-payload";
import { normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";

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
  const [momentumResult, beforeCrowdResult] = await Promise.allSettled([
    getRollingCanonicalDecisionFrame("momentum"),
    getRollingCanonicalDecisionFrame("before_crowd"),
  ]);

  if (momentumResult.status === "rejected") {
    console.error("[market] initial Spot Momentum snapshot failed:", momentumResult.reason);
  }
  if (beforeCrowdResult.status === "rejected") {
    console.error("[market] initial Before The Crowd snapshot failed:", beforeCrowdResult.reason);
  }

  const initialMomentumPayload = momentumResult.status === "fulfilled"
    ? compactHomeInitialOpportunityPayload(momentumResult.value, 15)
    : null;
  const initialBeforeCrowdPayload = beforeCrowdResult.status === "fulfilled"
    ? compactHomeInitialOpportunityPayload(beforeCrowdResult.value, 5)
    : null;

  return (
    <Suspense fallback={null}>
      <HomeClient
        surface="market"
        initialMomentumPayload={initialMomentumPayload}
        initialBeforeCrowdPayload={initialBeforeCrowdPayload}
      />
    </Suspense>
  );
}
