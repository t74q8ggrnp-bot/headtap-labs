/** Manual, read-only research audit. Never imported by a public route or a cron. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { CryptoLiveResearchInput, CryptoResearchCosts } from "../lib/crypto/live-research";
// @ts-expect-error Node strip-types requires source extensions.
import { rankCryptoLiveResearch } from "../lib/crypto/live-research.ts";
// @ts-expect-error Node strip-types requires source extensions.
import { createCoinApiClient } from "../lib/crypto/coinapi-client.ts";
// @ts-expect-error Node strip-types requires source extensions.
import { parseCoinApiBars, parseCoinApiBook, parseCoinApiTrade, COINAPI_VENUES } from "../lib/crypto/coinapi-normalize.ts";
// @ts-expect-error Node strip-types requires source extensions.
import { coinApiResearchEvidence } from "../lib/crypto/live-research-coinapi.ts";

async function main() {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "--input" && arg) {
    const file = readFileSync(arg, "utf8");
    const payload = JSON.parse(file) as { evidence: CryptoLiveResearchInput[]; costs?: CryptoResearchCosts | null };
    if (!Array.isArray(payload.evidence) || payload.evidence.length > 1000) throw new Error("Expected at most 1000 raw-evidence markets.");
    const result = rankCryptoLiveResearch(payload.evidence, payload.costs ?? null);
    process.stdout.write(JSON.stringify({ inputSha256: createHash("sha256").update(file).digest("hex"), result }, null, 2) + "\n");
    return;
  }
  if (mode !== "--live" || !arg) throw new Error("Use --input <saved-evidence.json> or --live <up to 3 CoinAPI native-USD market IDs>.");
  const marketIds = [...new Set(arg.split(","))];
  if (marketIds.length < 1 || marketIds.length > 3 || marketIds.some(id =>
    !/^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9][A-Z0-9.-]{0,19}_USD$/.test(id))) {
    throw new Error("Live audit accepts at most 3 native USD markets on supported venues.");
  }
  const client = createCoinApiClient({ apiKey: process.env.COINAPI_API_KEY ?? "", maxRequests: marketIds.length * 2 });
  const collected = await Promise.allSettled(marketIds.map(async symbolId => {
    const [bookPayload, barsPayload] = await Promise.all([
      client.get(`/v1/quotes/${symbolId}/current`),
      client.get(`/v1/ohlcv/${symbolId}/latest?period_id=1MIN&limit=65`),
    ]);
    const now = Date.now();
    const book = parseCoinApiBook(bookPayload, symbolId, now);
    const raw = bookPayload as { symbol_id: string; last_trade?: Record<string, unknown> };
    // The nested trade is scoped by the validated top-level market ID, not by a ticker guess.
    const trade = parseCoinApiTrade({ ...raw.last_trade, symbol_id: raw.symbol_id }, symbolId, now);
    const [venue, , base] = symbolId.split("_");
    if (!COINAPI_VENUES.includes(venue as typeof COINAPI_VENUES[number])) throw new Error("Unsupported venue.");
    return { market: { symbolId, venue: venue as typeof COINAPI_VENUES[number], base, quote: "USD", catalogAsOf: null, volume30d: null },
      trade, book, bars: parseCoinApiBars(barsPayload, now) };
  }));
  const decisionAt = new Date().toISOString();
  const evidence = collected.flatMap(result => result.status === "fulfilled"
    ? [coinApiResearchEvidence({ ...result.value, decisionAt })] : []);
  const result = rankCryptoLiveResearch(evidence);
  process.stdout.write(JSON.stringify({
    scope: "manual_read_only_sample_not_a_performance_evaluation", decisionAt,
    requestedMarkets: marketIds.length,
    collectionFailures: collected.flatMap((row, index) => row.status === "rejected"
      ? [{ marketId: marketIds[index], reason: "Provider response or evidence validation failed." }] : []),
    usage: client.usage(),
    inputSha256: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    evidence, costs: null,
    result,
  }, null, 2) + "\n");
}

main().catch(() => {
  // Do not echo arbitrary provider bodies or malformed input (they may contain secrets).
  process.stderr.write("Crypto research audit failed. Verify arguments, evidence shape, credentials and provider access. No orders or production updates were made.\n");
  process.exitCode = 1;
});
