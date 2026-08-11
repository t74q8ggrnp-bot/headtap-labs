import { NextResponse } from "next/server";
import { buildCryptoOpportunityFeed } from "@/lib/crypto/coinbase-public";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const feed = await buildCryptoOpportunityFeed();
    return NextResponse.json({
      success: true,
      publicScoreAuthority: feed.provider,
      discovery: feed.shadowDiscovery,
      timestamp: feed.timestamp,
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("[crypto-discovery] shadow feed failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Crypto discovery feed failed.",
        authority: "none",
      },
      { status: 503 },
    );
  }
}
