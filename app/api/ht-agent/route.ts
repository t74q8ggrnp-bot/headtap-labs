import { NextResponse } from "next/server";
import { authenticatePaperRequest } from "@/lib/paper-trading/server";
import {
  configureHtAgentProfile,
  loadHtAgentDashboard,
  loadHtAgentTradePlans,
  resolveHtAgentProposal,
  runHtAgentCycle,
} from "@/lib/ht-agent/server";
import type { HtAgentMode } from "@/lib/ht-agent/contracts";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const response = (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json({ contractVersion: "ht-agent-api-v1", ...body }, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", ...headers },
  });

export async function GET(request: Request) {
  const rate = checkApiRateLimit(request, { namespace: "ht-agent-read", limit: 120, windowMs: 60_000 });
  if (!rate.allowed) return response({ ok: false, error: "Too many HT Agent requests." }, 429, rate.headers);
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);
    if (new URL(request.url).searchParams.get("view") === "trade_plans") {
      return response({ ok: true, tradePlans: await loadHtAgentTradePlans(context) });
    }
    return response({ ok: true, dashboard: await loadHtAgentDashboard(context) });
  } catch (error) {
    console.error("[ht-agent] dashboard failed", error);
    return response({
      ok: false,
      error: "HT Agent is not ready. Confirm migration 0030 has been applied.",
    }, 503);
  }
}

export async function POST(request: Request) {
  const rate = checkApiRateLimit(request, { namespace: "ht-agent-action", limit: 20, windowMs: 60_000 });
  if (!rate.allowed) return response({ ok: false, error: "Too many HT Agent actions." }, 429, rate.headers);
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = String(body?.action ?? "");
    if (action === "configure") {
      const mode = body?.mode as HtAgentMode | undefined;
      if (mode && !["observe", "approval_paper", "paper_autopilot"].includes(mode)) {
        return response({ ok: false, error: "Invalid Agent mode." }, 400);
      }
      await configureHtAgentProfile(context, {
        mode,
        killSwitch: typeof body?.killSwitch === "boolean" ? body.killSwitch : undefined,
      });
      return response({ ok: true, dashboard: await loadHtAgentDashboard(context) });
    }
    if (action === "run") {
      const run = await runHtAgentCycle(context);
      return response({ ok: true, run, dashboard: await loadHtAgentDashboard(context) }, 201);
    }
    if (action === "approve" || action === "decline") {
      const decisionId = String(body?.decisionId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(decisionId)) {
        return response({ ok: false, error: "Invalid Agent decision id." }, 400);
      }
      const resolution = await resolveHtAgentProposal(context, decisionId, action === "approve");
      return response({ ok: true, resolution, dashboard: await loadHtAgentDashboard(context) });
    }
    return response({ ok: false, error: "Unsupported HT Agent action." }, 400);
  } catch (error) {
    console.error("[ht-agent] action failed", error);
    return response({
      ok: false,
      error: error instanceof Error ? error.message : "HT Agent request failed.",
    }, 503);
  }
}
