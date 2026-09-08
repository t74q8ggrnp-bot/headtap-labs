import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  INSTRUMENT_METADATA_TTL_MS,
  INSTRUMENT_SEARCH_MAX_RESULTS,
  InstrumentSearchError,
  normalizeInstrumentSearchQuery,
  searchMassiveInstruments,
} from "@/lib/instrument-search";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function errorStatus(error: InstrumentSearchError) {
  if (error.code === "missing_configuration") return 503;
  if (error.code === "not_found") return 404;
  return 502;
}

export async function GET(request: Request) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "public-instrument-search",
    limit: 60,
    windowMs: 60_000,
  });
  const headers = { ...RESPONSE_HEADERS, ...rateLimit.headers };
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Too many instrument searches. Please retry shortly.", code: "rate_limited" },
      { status: 429, headers },
    );
  }

  const url = new URL(request.url);
  const query = normalizeInstrumentSearchQuery(url.searchParams.get("q"));
  if (!query) {
    return Response.json(
      { ok: false, error: "Search requires 1–64 valid characters.", code: "invalid_query", results: [] },
      { status: 400, headers },
    );
  }
  const requestedLimit = Number(url.searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(INSTRUMENT_SEARCH_MAX_RESULTS, Math.floor(requestedLimit)))
    : 8;

  try {
    const result = await searchMassiveInstruments(query, { limit });
    return Response.json({
      ok: true,
      query: result.query,
      results: result.results,
      provider: result.provider,
      source: result.source,
      loadedAt: result.loadedAt,
      metadataCache: {
        state: result.cacheState,
        scope: "server",
        ttlSeconds: Math.floor(INSTRUMENT_METADATA_TTL_MS / 1_000),
      },
    }, { headers });
  } catch (error) {
    const typed = error instanceof InstrumentSearchError
      ? error
      : new InstrumentSearchError(
        "provider_unavailable",
        "Massive reference metadata is temporarily unavailable.",
      );
    console.error("[instrument-search] provider lookup failed", {
      code: typed.code,
      providerStatus: typed.providerStatus,
    });
    return Response.json(
      { ok: false, error: typed.message, code: typed.code, results: [] },
      { status: errorStatus(typed), headers },
    );
  }
}
