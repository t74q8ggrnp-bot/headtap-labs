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
import { buildFreshCryptoOpportunityFeedState } from "@/lib/crypto/coinbase-public";
import { isAllowedMainstreamCryptoAsset } from "@/lib/crypto/asset-policy";

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

export async function GET(req: Request) {
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

    const feedState = await buildFreshCryptoOpportunityFeedState();
    const discoveryPrices = feedState.discoveryPrices;
    const currentPriceByAssetId = new Map(
      discoveryPrices.map((price) => [price.assetId, price.priceUsd]),
    );
    const currentPriceBySymbol = new Map(
      discoveryPrices.map((price) => [price.symbol, price.priceUsd]),
    );
    const currentAssetIdsBySymbol = new Map<string, string[]>();
    for (const price of discoveryPrices) {
      const list = currentAssetIdsBySymbol.get(price.symbol) ?? [];
      list.push(price.assetId);
      currentAssetIdsBySymbol.set(price.symbol, list);
    }

    const rows = (overdueRows ?? []).map((row) => {
      const symbol = String(row.symbol ?? "");
      const exactPrice = currentPriceByAssetId.get(row.asset_id);
      const symbolPrice = currentPriceBySymbol.get(symbol);
      const resolvedPrice = exactPrice ?? symbolPrice;
      const entryPrice = Number(row.entry_price_usd);
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
          currentPriceBySymbol.has(symbol),
        currentAssetIdsForSymbol: currentAssetIdsBySymbol.get(symbol) ?? [],
        resolvedPriceViaFix: resolvedPrice ?? null,
        wouldUpdateWithFix: Boolean(
          resolvedPrice &&
          resolvedPrice > 0 &&
          Number.isFinite(entryPrice) &&
          entryPrice > 0,
        ),
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
      wouldUpdateWithFixCount: rows.filter((row) => row.wouldUpdateWithFix).length,
      discoveryPricesCount: discoveryPrices.length,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
