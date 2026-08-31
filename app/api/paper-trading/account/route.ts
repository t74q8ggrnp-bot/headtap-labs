import { NextResponse } from "next/server";
import {
  authenticatePaperRequest,
  loadPaperDashboard,
} from "@/lib/paper-trading/server";
import { PAPER_TRADING_CONTRACT_VERSION } from "@/lib/paper-trading/engine";

export const dynamic = "force-dynamic";

const response = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json({ contractVersion: PAPER_TRADING_CONTRACT_VERSION, ...body }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });

export async function GET(request: Request) {
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);
    return response({ ok: true, dashboard: await loadPaperDashboard(context) });
  } catch (error) {
    console.error("[manual-paper] account read failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return response({
      ok: false,
      error: "Paper trading is not ready. Confirm migration 0024 has been applied.",
    }, 503);
  }
}
