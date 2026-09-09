import { NextResponse } from "next/server";
import {
  PAPER_CLOSE_ACTION,
  PAPER_TRADING_CONTRACT_VERSION,
} from "@/lib/paper-trading/engine";
import {
  HT_MARKET_DATA_AUTHORITY,
  HT_REFRESH_RATES_MS,
  HT_REQUIRED_MIGRATIONS,
  HT_RUNTIME_CONTRACT_VERSION,
} from "@/lib/runtime-capabilities";
import {
  CRYPTO_PRODUCT_CAPABILITIES,
  CRYPTO_PRODUCT_CAPABILITY_POLICY_VERSION,
  cryptoProviderCallsAreProhibited,
  isCryptoProductIntentionallyShelved,
} from "@/lib/crypto/product-capabilities";

export const dynamic = "force-dynamic";

export async function GET() {
  const cryptoShelved = isCryptoProductIntentionallyShelved();
  const cryptoProviderCallsAllowed = !cryptoProviderCallsAreProhibited();

  return NextResponse.json({
    ok: true,
    contractVersion: HT_RUNTIME_CONTRACT_VERSION,
    marketData: {
      ...HT_MARKET_DATA_AUTHORITY,
      dataMode: "real_time_rest",
      refreshRatesMs: HT_REFRESH_RATES_MS,
      activeStockSession: {
        timeZone: "America/New_York",
        weekdays: true,
        startsAt: "04:00",
        endsAt: "20:00",
      },
    },
    paperTrading: {
      contractVersion: PAPER_TRADING_CONTRACT_VERSION,
      authority: "manual_simulation_only",
      liveBrokerConnection: false,
      endpoints: {
        account: "/api/paper-trading/account",
        instrument: "/api/paper-trading/instrument",
        orders: "/api/paper-trading/orders",
      },
      closePosition: {
        method: "POST",
        endpoint: "/api/paper-trading/orders",
        canonicalField: { closePosition: true },
        compatibleAction: { action: PAPER_CLOSE_ACTION },
        serverDerivesSideAndFullQuantity: true,
      },
    },
    agentXVisualPlans: {
      contractVersion: "agent-x-visual-plan-api-v1",
      authority: "paper_plan_visualization_only",
      endpoint: "/api/ht-agent/plans?symbol={ticker}",
      lifecycleEvidence: "completed_massive_provider_minutes",
      displayTimeframes: ["1m", "5m", "15m"],
      executionAuthority: "none",
      manualPaperReviewOnly: true,
      liveBrokerConnection: false,
    },
    crypto: {
      status: cryptoShelved ? "shelved" : "active_or_partial",
      policyVersion: CRYPTO_PRODUCT_CAPABILITY_POLICY_VERSION,
      capabilities: CRYPTO_PRODUCT_CAPABILITIES,
      endpointLinks: {},
      providerCallsAllowed: cryptoProviderCallsAllowed,
      reactivationRequiresReviewedCodeChange: true,
    },
    requiredMigrations: HT_REQUIRED_MIGRATIONS,
    scoring: {
      browserAuthority: "presentation_only",
      canonicalAuthorityChanged: false,
      proxIndependentBoardAuthority: "shadow_research_only",
      executionAuthority: "none",
    },
    generatedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
