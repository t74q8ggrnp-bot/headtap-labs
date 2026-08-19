import { NextResponse } from "next/server";
import { buildFreshCryptoOpportunityFeedState } from "@/lib/crypto/coinbase-public";
import {
  loadLatestCryptoDecisionFeed,
  makeCryptoFrameSafeForStaleDisplay,
} from "@/lib/crypto/decision-frame";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const materialized = await loadLatestCryptoDecisionFeed();
    let feed = materialized;
    if (!feed) {
      try {
        feed = (await buildFreshCryptoOpportunityFeedState()).feed;
      } catch (providerError) {
        const stale = await loadLatestCryptoDecisionFeed({ allowStale: true });
        if (!stale) throw providerError;
        feed = makeCryptoFrameSafeForStaleDisplay(stale);
      }
    }
    return NextResponse.json(feed, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("[crypto-opportunities] feed failed:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Crypto opportunity feed failed.",
      },
      { status: 503 },
    );
  }
}
