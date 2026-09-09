import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { fetchMassiveCryptoQuotes } from "@/lib/massive-crypto";
import { withCryptoCapabilities } from "@/lib/crypto/product-capabilities";

async function postCryptoQuotes(request: Request) {
  const limit = checkApiRateLimit(request, { namespace: "public-crypto-quotes", limit: 60, windowMs: 60_000 });
  const headers = { "Cache-Control": "private, no-store", ...limit.headers };
  if (!limit.allowed) return Response.json({ quotes: {}, error: "Too many requests." }, { status: 429, headers });
  let products: string[];
  try {
    const body = await request.json();
    if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > 250 ||
      body.products.some((p: unknown) => typeof p !== "string" || !/^[A-Z0-9]{1,20}-USD$/.test(p))) throw Error("Invalid products");
    products = [...new Set(body.products as string[])];
  } catch {
    return Response.json({ quotes: {}, error: "Provide 1–250 valid USD crypto products." }, { status: 400, headers });
  }
  try {
    return Response.json({ quotes: await fetchMassiveCryptoQuotes(products), source: "massive_crypto_trade" }, { headers });
  } catch {
    return Response.json({ quotes: {}, error: "Massive crypto prices unavailable." }, { status: 502, headers });
  }
}

export const POST = withCryptoCapabilities(
  ["publicApiEnabled", "providerCollectionEnabled"],
  postCryptoQuotes,
);
