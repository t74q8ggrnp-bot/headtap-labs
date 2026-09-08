import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { coinApiPilotReaderAuthorized, coinApiPilotService } from "@/lib/crypto/coinapi-pilot-server";
import { createHash } from "node:crypto";
import { canonicalCryptoJson } from "@/lib/crypto/coinapi-publication";
import { assessCryptoEvidenceHealth } from "@/lib/crypto/evidence-health";
import { readCryptoOutcomeProcessingEvidence } from "@/lib/crypto/outcome-processing-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Shared evidence/coverage, not a profitability or trade-authorization endpoint. */
export async function GET(request: Request) {
  const rate = checkApiRateLimit(request, { namespace: "coinapi-evaluation", limit: 5, windowMs: 60_000 });
  const headers = { "Cache-Control": "private, no-store", ...rate.headers };
  if (!rate.allowed) return Response.json({ error: "Too many requests." }, { status: 429, headers });
  const episodeId = new URL(request.url).searchParams.get("episodeId");
  if (episodeId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(episodeId)) {
    return Response.json({ error: "Invalid episode ID." }, { status: 400, headers });
  }
  try {
    if (!await coinApiPilotReaderAuthorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
    const db = coinApiPilotService();
    if (episodeId) {
      const episode = await db.from("ht_crypto_research_episodes").select("*").eq("id",episodeId).maybeSingle();
      if (episode.error) throw new Error("Episode storage unavailable.");
      if (!episode.data) return Response.json({ error:"Episode not found." },{ status:404,headers });
      const start = Date.parse(episode.data.decision_at);
      const [cycle,books,outcomes] = await Promise.all([
        db.from("ht_coinapi_pilot_cycles").select("frame,evidence_sha256").eq("id",episode.data.cycle_id).eq("status","complete").single(),
        db.from("ht_crypto_research_books").select("market_id,provider_at,received_at,bid,ask,bid_size,ask_size,source_version")
          .eq("market_id",episode.data.market_id).gte("provider_at",new Date(start - 15_000).toISOString())
          .lte("provider_at",new Date(start + 3_665_000).toISOString()).order("provider_at").limit(500),
        db.from("ht_crypto_verified_research_outcomes").select("*").eq("episode_id",episodeId),
      ]);
      if (cycle.error || books.error || outcomes.error || !cycle.data ||
          cycle.data.frame?.dataContractVersion !== "coinapi-research-data-v2" ||
          createHash("sha256").update(canonicalCryptoJson(cycle.data.frame)).digest("hex") !== cycle.data.evidence_sha256) {
        throw new Error("Unverified episode evidence.");
      }
      return Response.json({ version:"coinapi-episode-export-v1", authority:"research_only", providerRequests:0,
        episode:episode.data, evidenceHash:cycle.data.evidence_sha256, frame:cycle.data.frame,
        books:books.data, outcomes:outcomes.data, booksLimit:500, possiblyTruncated:books.data?.length === 500,
        // An archived research score is not an executed/frozen baseline choice.
        frozenBaselineChoice:null, frozenCandidateChoice:null, feePolicy:null,
        executionAuthorized:false, profitabilityEstablished:false },{ headers });
    }
    const [readiness, sources, outcomes, legacyTracking, snapshot] = await Promise.all([
      db.from("ht_crypto_research_readiness").select("*").single(),
      db.from("ht_crypto_outcome_source_policy").select("source_table,evaluation_allowed,reason,policy_version"),
      db.from("ht_crypto_verified_research_outcomes").select("episode_id,horizon_seconds,target_at,status,reason,exit_book_id,resolved_at,gross_quote_return_percent,quarantined,evaluation_eligible")
        .order("target_at", { ascending: false }).limit(100),
      db.from("ht_crypto_legacy_tracking_readiness").select("*"),
      db.rpc("ht_crypto_evidence_health_snapshot"),
    ]);
    if (readiness.error || sources.error || outcomes.error || !readiness.data || sources.data?.length !== 2 ||
        sources.data.some(row => row.evaluation_allowed !== false)) throw new Error("Unverified evidence schema.");
    const outcomeProcessing = snapshot.error || !snapshot.data ? null : await readCryptoOutcomeProcessingEvidence(db);
    const evidenceHealth = assessCryptoEvidenceHealth(snapshot.error || !snapshot.data ? null : {...snapshot.data,outcomeProcessing}, {
      production: process.env.VERCEL_ENV === "production",
      environmentEnabled: process.env.COINAPI_PILOT_ENABLED === "true",
      credentialConfigured: Boolean(process.env.COINAPI_API_KEY?.trim()),
    }, Date.now(), snapshot.error);
    return Response.json({
      version: "coinapi-evaluation-read-v1", authority: "research_only", providerRequests: 0,
      schemaReady: true,
      ledgerHealthy: evidenceHealth.checks.find(check => check.name === "crypto_coinapi_outcomes")?.ok === true,
      healthVerified: evidenceHealth.checks.every(check => check.ok),
      healthChecks: evidenceHealth.checks, warnings: evidenceHealth.warnings,
      coverage: readiness.data, quarantinedSources: sources.data,
      legacyTracking: {
        schemaReady: !legacyTracking.error && legacyTracking.data?.length === 2,
        rows: legacyTracking.error ? [] : legacyTracking.data,
        message: legacyTracking.error ? "Apply migration 0037 to stop new legacy outcome deadlines; old evidence remains excluded." :
          "Legacy observations are preserved, not verified outcomes. New observations have no legacy outcome deadlines.",
      },
      outcomes: outcomes.data, outcomesLimit: 100,
      interpretation: "Observed horizons are gross ask-to-bid quote returns, not fills or net profits. Missing horizons remain unavailable.",
      averageNetProfit: null, netDrawdown: null, improvementAgainstBaseline: null,
      missingForProfitability: ["matched_frozen_baseline", "venue_fee_policy", "liquidity_and_delay_verified_fills", "later_unseen_evaluation"],
      publicCutoverAuthorized: false, executionAuthorized: false, profitabilityEstablished: false,
    }, { headers });
  } catch {
    return Response.json({ schemaReady: false, error: "Crypto evidence unavailable; verify migration 0036. No provider requests were made.",
      executionAuthorized: false }, { status: 503, headers });
  }
}
