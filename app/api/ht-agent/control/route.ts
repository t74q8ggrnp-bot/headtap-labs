import { NextResponse } from "next/server";
import { getPaperServiceClient } from "@/lib/paper-trading/server";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

const response = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });

export async function GET(request: Request) {
  if (!authorized(request)) return response({ ok: false, error: "Unauthorized" }, 401);
  const service = getPaperServiceClient();
  const control = await service.from("ht_agent_global_control")
    .select("kill_switch,reason,policy_version,updated_at")
    .eq("id", "global")
    .single();
  if (control.error) return response({ ok: false, error: control.error.message }, 503);
  return response({
    ok: true,
    authority: "ht_agent_global_fail_closed_control",
    control: control.data,
    liveBrokerage: false,
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) return response({ ok: false, error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (typeof body?.killSwitch !== "boolean") {
    return response({ ok: false, error: "killSwitch must be a boolean." }, 400);
  }
  const reason = String(body.reason ?? "Operator control update").trim().slice(0, 500);
  if (!reason) return response({ ok: false, error: "A control reason is required." }, 400);
  const service = getPaperServiceClient();
  const previous = await service.from("ht_agent_global_control")
    .select("kill_switch,reason,policy_version,updated_at")
    .eq("id", "global")
    .single();
  if (previous.error) return response({ ok: false, error: previous.error.message }, 503);
  const updated = await service.from("ht_agent_global_control").update({
    kill_switch: body.killSwitch,
    reason,
    updated_at: new Date().toISOString(),
  }).eq("id", "global")
    .select("kill_switch,reason,policy_version,updated_at")
    .single();
  if (updated.error) return response({ ok: false, error: updated.error.message }, 503);
  const journal = await service.from("ht_agent_control_events").insert({
    scope: "global",
    event_type: "global_control_changed",
    previous_state: previous.data,
    next_state: updated.data,
    reason,
  });
  if (journal.error) return response({ ok: false, error: journal.error.message }, 503);
  return response({
    ok: true,
    authority: "ht_agent_global_fail_closed_control",
    control: updated.data,
    liveBrokerage: false,
  });
}
