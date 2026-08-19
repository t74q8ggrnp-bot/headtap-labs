import { NextResponse } from "next/server";
import { CANONICAL_OPPORTUNITY_VERSION } from "@/lib/canonical-opportunity";
import {
  buildCanonicalOpportunityFeed,
  type OpportunityFeedRequestType,
} from "@/lib/canonical-opportunity-feed";
import { getRollingCanonicalDecisionFrame } from "@/lib/canonical-decision-frame";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OPPORTUNITY_CACHE_HEADERS = {
  // Spot Momentum and Before The Crowd must resolve the same latest promoted
  // run. A stale-while-revalidate window allowed the two query variants to
  // temporarily serve different run IDs after promotion, so canonical reads
  // now bypass edge storage. Expensive historical features remain cached in
  // Supabase by the trade-framework layer.
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Vercel-Cache-Tag": "canonical-opportunities",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedType = (url.searchParams.get("type") ??
    "all") as OpportunityFeedRequestType;
  const parsedLimit = Number.parseInt(
    url.searchParams.get("limit") ?? "10",
    10,
  );
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 10;

  try {
    const debug = url.searchParams.get("debug") === "1";
    const includeContinuation =
      url.searchParams.get("includeContinuation") === "1";
    const payload = requestedType === "momentum" || requestedType === "before_crowd"
      ? await getRollingCanonicalDecisionFrame(requestedType)
      : await buildCanonicalOpportunityFeed({
          requestedType,
          limit,
          debug,
          includeContinuation,
        });
    const responsePayload: Record<string, unknown> = {
      ...payload,
      opportunities: Array.isArray(payload.opportunities)
        ? payload.opportunities.slice(0, limit)
        : [],
    };
    if (!debug) delete responsePayload.rejectedSample;
    if (!includeContinuation) {
      delete responsePayload.continuationCandidates;
    }
    return NextResponse.json(responsePayload, {
      headers: OPPORTUNITY_CACHE_HEADERS,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to produce opportunities.",
        opportunities: [],
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
      },
      { status: 500 },
    );
  }
}
