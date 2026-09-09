import { Suspense } from "react";
import HomeClient from "./HomeClient";
import { getRollingCanonicalDecisionFrame } from "@/lib/canonical-decision-frame";
import { compactHomeInitialOpportunityPayload } from "@/lib/home-initial-payload";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [momentumResult, beforeCrowdResult] =
    await Promise.allSettled([
      getRollingCanonicalDecisionFrame("momentum"),
      getRollingCanonicalDecisionFrame("before_crowd"),
    ]);

  if (momentumResult.status === "rejected") {
    console.error(
      "[home] initial Spot Momentum snapshot failed:",
      momentumResult.reason,
    );
  }
  if (beforeCrowdResult.status === "rejected") {
    console.error(
      "[home] initial Before The Crowd snapshot failed:",
      beforeCrowdResult.reason,
    );
  }
  const initialMomentumPayload =
    momentumResult.status === "fulfilled"
      ? compactHomeInitialOpportunityPayload(momentumResult.value, 15)
      : null;
  const initialBeforeCrowdPayload =
    beforeCrowdResult.status === "fulfilled"
      ? compactHomeInitialOpportunityPayload(beforeCrowdResult.value, 5)
      : null;

  return (
    <Suspense fallback={null}>
      <HomeClient
        initialMomentumPayload={initialMomentumPayload}
        initialBeforeCrowdPayload={initialBeforeCrowdPayload}
      />
    </Suspense>
  );
}
