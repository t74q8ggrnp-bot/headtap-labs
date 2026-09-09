import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { coinApiPilotReaderAuthorized, readCoinApiPilot } from "@/lib/crypto/coinapi-pilot-server";
import { withCryptoCapabilities } from "@/lib/crypto/product-capabilities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getCoinApiResearch(request: Request) {
  const rate = checkApiRateLimit(request, { namespace: "coinapi-research-read", limit: 20, windowMs: 60_000 });
  const headers = { "Cache-Control": "private, no-store", ...rate.headers };
  if (!rate.allowed) return Response.json({ error: "Too many requests." }, { status: 429, headers });
  const marketId = new URL(request.url).searchParams.get("marketId") ?? undefined;
  if (marketId && !/^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD$/.test(marketId)) {
    return Response.json({ error: "Use an exact CoinAPI native-USD market ID." }, { status: 400, headers });
  }
  try {
    if (!await coinApiPilotReaderAuthorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
    const result = await readCoinApiPilot(marketId);
    const healthy = result.status === "collecting" && result.freshAlignedQuoteCount > 0;
    return Response.json({ ...result, ok: healthy }, { headers });
  } catch {
    return Response.json({ ok: false, error: "CoinAPI research storage unavailable. No provider requests were made." }, { status: 503, headers });
  }
}

export const GET = withCryptoCapabilities(
  "publicApiEnabled",
  getCoinApiResearch,
);
