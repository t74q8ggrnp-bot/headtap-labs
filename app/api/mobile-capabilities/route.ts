import { NextResponse } from "next/server";
import {
  PAPER_CLOSE_ACTION,
  PAPER_TRADING_CONTRACT_VERSION,
} from "@/lib/paper-trading/engine";
import {
  HT_MARKET_DATA_AUTHORITY,
  HT_REFRESH_RATES_MS,
  HT_RUNTIME_CONTRACT_VERSION,
} from "@/lib/runtime-capabilities";

export const dynamic = "force-dynamic";

export async function GET() {
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
    requiredMigrations: [
      "0024_manual_paper_trading.sql",
      "0025_prox_shadow_episode_scorecard.sql",
      "0026_market_data_timestamp_authority.sql",
      "0027_prox_realtime_microstructure_observations.sql",
      "0028_paper_match_health.sql",
    ],
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
