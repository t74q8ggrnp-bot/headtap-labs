// app/api/crypto-outcome-diagnostics/route.ts
//
// Read-only: lists the ht_crypto_discovery_observations rows whose 15-minute
// outcome is missing. This is quarantined historical evidence: current quotes
// or matching symbols on another exchange cannot resolve these horizons.
// No upstream provider call and no writes anywhere.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import { legacyCryptoOutcomeQuarantine } from "@/lib/crypto/outcome-integrity";
import { withCryptoCapabilities } from "@/lib/crypto/product-capabilities";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(req: Request) {
  return Boolean(
    CRON_SECRET &&
      req.headers.get("authorization") === `Bearer ${CRON_SECRET}`,
  );
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

async function getCryptoOutcomeDiagnostics(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabase();
    const overdueCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: overdueRows, error: overdueError } = await supabase
      .from("ht_crypto_discovery_observations")
      .select("id,asset_id,symbol,observed_at,target_15m_at,entry_price_usd")
      .is("price_15m_usd", null)
      .lte("target_15m_at", overdueCutoff)
      .like("asset_id", "crypto:%:%")
      .order("target_15m_at", { ascending: true })
      .limit(50);
    if (overdueError) throw overdueError;

    const rows = (overdueRows ?? []).map((row) => {
      const symbol = String(row.symbol ?? "");
      return {
        assetId: row.asset_id,
        symbol,
        observedAt: row.observed_at,
        targetAt: row.target_15m_at,
        entryPrice: row.entry_price_usd,
        evaluationEligible: false,
        reason: "legacy_entry_and_horizon_provider_times_unverified",
      };
    });

    return NextResponse.json({
      ok: true,
      status: "quarantined",
      outcomeEvidence: legacyCryptoOutcomeQuarantine(),
      missingHorizonSampleCount: rows.length,
      sampleLimit: 50,
      providerRequests: 0,
      backfillWithCurrentPricesAllowed: false,
      verifiedResearchEndpoint: "/api/crypto/coinapi-evaluation",
      rows,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}

export const GET = withCryptoCapabilities(
  "publicApiEnabled",
  getCryptoOutcomeDiagnostics,
);
