import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { fetchNewsIntel } from "@/lib/news-intel";
import { checkDurableApiRateLimit, recordExternalRequestTelemetry } from "@/lib/durable-api-guard";
import { normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";

const cachedNewsIntel = unstable_cache(fetchNewsIntel, ["news-intel-v2"], {
  revalidate: 300,
  tags: ["news-intel"],
});

export async function GET(req: Request) {
  const rateLimit = await checkDurableApiRateLimit(req, {
    namespace: "public-news-intel",
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({
      status: "unavailable",
      code: "rate_limited",
      message: "News intelligence is temporarily unavailable.",
    }, { status: 429, headers: rateLimit.headers });
  }
  const { searchParams } = new URL(req.url);
  const symbol = normalizeMarketWorkspaceSymbol(searchParams.get("symbol"));

  if (!symbol) {
    return NextResponse.json({
      status: "unavailable",
      code: "invalid_symbol",
      message: "A valid stock or ETF symbol is required.",
    }, { status: 400, headers: rateLimit.headers });
  }

  const payload = await cachedNewsIntel(symbol);
  void recordExternalRequestTelemetry({
    endpoint: "/api/news-intel",
    provider: "finnhub+newsapi",
    operation: "news_enrichment",
    requestCount: payload.providerRequests,
    outcome: payload.dataAvailable ? "success" : "unavailable",
    sourceTimestamp: payload.newestArticleAt,
    metadata: { symbol, dataAvailable: payload.dataAvailable },
  });
  return NextResponse.json(payload, {
    headers: {
      ...rateLimit.headers,
      "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=300",
    },
  });
}
