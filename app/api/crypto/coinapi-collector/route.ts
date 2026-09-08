import { coinApiPilotCronAuthorized, runCoinApiPilot } from "@/lib/crypto/coinapi-pilot-server";
import { CryptoStorageError } from "@/lib/crypto/storage-diagnostics";
import { matchCryptoPaperOrders } from "@/lib/crypto/paper-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90; // Same cadence/provider budget; allow bounded ledger maintenance too.

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!coinApiPilotCronAuthorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  try {
    const result = await runCoinApiPilot();
    // Consume saved quotes only; explicit user orders are the sole authority.
    // Matching failure must not roll back or misreport a committed publication.
    // Expiry/cancellation accounting must keep working when collection is off.
    const paper = await matchCryptoPaperOrders()
      .catch(()=>({ok:false,processed:0,fills:0,providerRequests:0}));
    console.info("[coinapi-collector]", JSON.stringify({ status:result.status,
      ...("reason" in result ? { reason:result.reason } : {}),
      ...("cycleId" in result ? { cycleId:result.cycleId, usage:result.usage, timings:result.timings, history:result.history,
        freshAlignedQuotes:result.freshAlignedQuotes, scored:result.scored } : {}),
      paper, executionAuthorized:false }));
    return Response.json({ ...result, paper, archiveScheduledSeparately:true }, { headers });
  }
  catch (error) {
    const paper = await matchCryptoPaperOrders().catch(()=>({ok:false,processed:0,fills:0,providerRequests:0}));
    const diagnostic = error instanceof CryptoStorageError
      ? { stage:error.stage, ...error.diagnostic } : { stage:"collection", code:null, kind:"collection_failed" };
    console.error("[coinapi-collector]", JSON.stringify(diagnostic));
    return Response.json({ status: "needs_attention", error: "CoinAPI research collector failed. Inspect the operation diagnostic and stored credit receipts.", diagnostic, paper }, { status: 503, headers });
  }
}
