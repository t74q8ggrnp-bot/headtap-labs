import { Suspense } from "react";
import HomeClient from "./HomeClient";
import { buildCanonicalOpportunityFeed } from "@/lib/canonical-opportunity-feed";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [momentumResult, beforeCrowdResult] =
    await Promise.allSettled([
      buildCanonicalOpportunityFeed({
        requestedType: "momentum",
        limit: 100,
      }),
      buildCanonicalOpportunityFeed({
        requestedType: "before_crowd",
        limit: 100,
      }),
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
  return (
    <Suspense fallback={null}>
      <HomeClient
        initialMomentumPayload={
          momentumResult.status === "fulfilled" ? momentumResult.value : null
        }
        initialBeforeCrowdPayload={
          beforeCrowdResult.status === "fulfilled"
            ? beforeCrowdResult.value
            : null
        }
        initialCryptoFeed={null}
      />
    </Suspense>
  );
}
