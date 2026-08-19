// app/api/crypto-outcome-diagnostics/route.ts
//
// Read-only: lists the ht_crypto_discovery_observations rows whose 15-minute
// outcome is overdue (target_15m_at passed, price_15m_usd still null), and
// checks whether each row's exact asset_id currently appears in a freshly
// computed multi-venue discovery price snapshot. This exists to diagnose why
// crypto_multivenue_shadow_discovery's overdue15mOutcomes count stays
// nonzero -- no writes anywhere.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import { loadCryptoDiscoverySources } from "@/lib/crypto/multi-venue-discovery";
import { buildCryptoShadowDiscovery } from "@/lib/crypto/multi-venue-discovery";
import { isAllowedMainstreamCryptoAsset } from "@/lib/crypto/asset-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

export async function GET() {
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

    const sources = await loadCryptoDiscoverySources();
    const shadow = buildCryptoShadowDiscovery({
      coinbaseOpportunities: [],
      sources,
    });
    const currentPriceByAssetId = new Map(
      shadow.prices.map((price) => [price.assetId, price.priceUsd]),
    );
    const currentAssetIdsBySymbol = new Map<string, string[]>();
    for (const price of shadow.prices) {
      const list = currentAssetIdsBySymbol.get(price.symbol) ?? [];
      list.push(price.assetId);
      currentAssetIdsBySymbol.set(price.symbol, list);
    }

    const rows = (overdueRows ?? []).map((row) => {
      const symbol = String(row.symbol ?? "");
      return {
        assetId: row.asset_id,
        symbol,
        observedAt: row.observed_at,
        targetAt: row.target_15m_at,
        entryPrice: row.entry_price_usd,
        policyAllowed: isAllowedMainstreamCryptoAsset(symbol),
        exactAssetIdFoundNow: currentPriceByAssetId.has(row.asset_id),
        symbolFoundUnderDifferentAssetIdNow:
          !currentPriceByAssetId.has(row.asset_id) &&
          (currentAssetIdsBySymbol.get(symbol)?.length ?? 0) > 0,
        currentAssetIdsForSymbol: currentAssetIdsBySymbol.get(symbol) ?? [],
      };
    });

    return NextResponse.json({
      ok: true,
      overdueCount: rows.length,
      exactMatchFoundNow: rows.filter((row) => row.exactAssetIdFoundNow).length,
      policyBlockedNow: rows.filter((row) => !row.policyAllowed).length,
      assetIdDriftedNow: rows.filter(
        (row) => row.symbolFoundUnderDifferentAssetIdNow,
      ).length,
      neitherFoundNow: rows.filter(
        (row) =>
          !row.exactAssetIdFoundNow &&
          !row.symbolFoundUnderDifferentAssetIdNow &&
          row.policyAllowed,
      ).length,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
