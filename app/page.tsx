import { Suspense } from "react";
import HomeClient from "./HomeClient";
import { getRollingCanonicalDecisionFrame } from "@/lib/canonical-decision-frame";
import {
  loadLatestCryptoDecisionFeed,
  makeCryptoFrameSafeForStaleDisplay,
} from "@/lib/crypto/decision-frame";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [momentumResult, beforeCrowdResult, cryptoResult] =
    await Promise.allSettled([
      getRollingCanonicalDecisionFrame("momentum"),
      getRollingCanonicalDecisionFrame("before_crowd"),
      loadLatestCryptoDecisionFeed({ allowStale: true }),
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
  if (cryptoResult.status === "rejected") {
    console.error("[home] initial Crypto snapshot failed:", cryptoResult.reason);
  }
  const initialCryptoFeed =
    cryptoResult.status === "fulfilled" && cryptoResult.value
      ? cryptoResult.value.decisionFrame.fresh
        ? cryptoResult.value
        : makeCryptoFrameSafeForStaleDisplay(cryptoResult.value)
      : null;
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
        initialCryptoFeed={initialCryptoFeed}
      />
    </Suspense>
  );
}
