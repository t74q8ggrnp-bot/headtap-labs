import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  INSTRUMENT_METADATA_TTL_MS,
  InstrumentSearchError,
  fetchMassiveInstrument,
  normalizeInstrumentSymbol,
} from "@/lib/instrument-search";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=300, stale-while-revalidate=3600",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function errorStatus(error: InstrumentSearchError) {
  if (error.code === "missing_configuration") return 503;
  if (error.code === "not_found") return 404;
  return 502;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "public-instrument-detail",
    limit: 120,
    windowMs: 60_000,
  });
  const headers = { ...RESPONSE_HEADERS, ...rateLimit.headers };
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Too many instrument requests. Please retry shortly.", code: "rate_limited" },
      { status: 429, headers },
    );
  }

  const symbol = normalizeInstrumentSymbol((await params).ticker);
  if (!symbol) {
    return Response.json(
      { ok: false, error: "A valid stock or ETF symbol is required.", code: "invalid_symbol" },
      { status: 400, headers },
    );
  }

  try {
    const result = await fetchMassiveInstrument(symbol);
    if (!result.instrument.workspaceSupported) {
      return Response.json({
        ok: false,
        error: "The Phase 1 workspace supports active U.S. stocks and ETFs only.",
        code: "unsupported_instrument",
        availability: "unavailable",
        provider: result.provider,
        source: result.source,
        loadedAt: result.loadedAt,
      }, { status: 422, headers });
    }
    return Response.json({
      ok: true,
      instrument: result.instrument,
      availability: "available",
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
    console.error("[instrument-detail] provider lookup failed", {
      symbol,
      code: typed.code,
      providerStatus: typed.providerStatus,
    });
    return Response.json(
      { ok: false, error: typed.message, code: typed.code },
      { status: errorStatus(typed), headers },
    );
  }
}
