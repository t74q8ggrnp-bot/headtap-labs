import { NextResponse } from "next/server";
import { authenticatePaperRequest } from "@/lib/paper-trading/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  HT_AGENT_VISUAL_PLAN_API_VERSION,
  HT_AGENT_VISUAL_PLAN_VERSION,
} from "@/lib/ht-agent/contracts";
import type { HtChartObject, HtChartObjectStatus } from "@/lib/chart-objects";
import { isHtChartObject } from "@/lib/chart-objects";
import type { AgentPlanLifecycleState, AgentXVisualPlanDefinition } from "@/lib/ht-agent/visual-plan";
import { buildProxChartContext } from "@/lib/ht-agent/visual-plan";
import type { HtAgentDecisionFrame } from "@/lib/ht-agent/contracts";
import type { PaperServerContext } from "@/lib/paper-trading/server";
import { visualPlanObjectFreshness } from "@/lib/ht-agent/visual-plan-api";
import { visualPlanSymbolInScope } from "@/lib/ht-agent/visual-plan-rollout";

export const dynamic = "force-dynamic";

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;

function response(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json({ contractVersion: HT_AGENT_VISUAL_PLAN_API_VERSION, ...body }, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", ...headers },
  });
}

function objectStatus(state: AgentPlanLifecycleState): HtChartObjectStatus {
  if (state === "target_reached") return "reached";
  if (state === "invalidated") return "invalidated";
  if (state === "expired") return "expired";
  if (state === "needs_review_ambiguous") return "needs_review_ambiguous";
  return "active";
}

async function loadLatestProxObjects(input: {
  service: PaperServerContext["service"];
  profileId: string;
  symbol: string;
}) {
  const frameResult = await input.service.from("ht_agent_decision_frames")
    .select("id,frame_version,captured_at,market_facts,prox_evidence")
    .eq("profile_id", input.profileId)
    .eq("symbol", input.symbol)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (frameResult.error) throw frameResult.error;
  if (!frameResult.data) return [];
  const decision = await input.service.from("ht_agent_decisions")
    .select("id")
    .eq("frame_id", frameResult.data.id)
    .eq("profile_id", input.profileId)
    .limit(1)
    .maybeSingle();
  if (decision.error) throw decision.error;
  if (!decision.data) return [];
  const frame = {
    version: frameResult.data.frame_version,
    frameId: frameResult.data.id,
    capturedAt: frameResult.data.captured_at,
    market: frameResult.data.market_facts,
    prox: frameResult.data.prox_evidence,
  } as unknown as HtAgentDecisionFrame;
  return buildProxChartContext(frame, String(decision.data.id)).map((object) => {
    const freshness = visualPlanObjectFreshness(object.timing.marketEvidenceAt);
    return {
      ...object,
      status: freshness === "stale" ? "historical" as const : object.status,
      timing: {
        ...object.timing,
        freshness,
      },
    };
  });
}

export async function GET(request: Request) {
  const rate = checkApiRateLimit(request, { namespace: "ht-agent-plan-read", limit: 180, windowMs: 60_000 });
  if (!rate.allowed) return response({ ok: false, error: "Too many plan requests." }, 429, rate.headers);
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!SYMBOL.test(symbol)) return response({ ok: false, error: "A valid symbol is required." }, 400);
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);
    const control = await context.service.from("ht_agent_global_control")
      .select("visual_plan_mode,visual_plan_paper_handoff_enabled,visual_plan_symbol_scope,kill_switch")
      .eq("id", "global")
      .single();
    if (control.error) throw control.error;
    const rolloutMode = String(control.data.visual_plan_mode) as "off" | "shadow" | "visible";
    if (rolloutMode !== "visible") {
      return response({
        ok: true,
        symbol,
        rolloutMode,
        visible: false,
        unavailableReason: rolloutMode === "shadow" ? "verification_in_progress" : "feature_off",
        chartObjects: [],
        plan: null,
        servedAt: new Date().toISOString(),
      });
    }
    if (!visualPlanSymbolInScope(control.data.visual_plan_symbol_scope, symbol)) {
      return response({
        ok: true,
        symbol,
        rolloutMode,
        visible: false,
        unavailableReason: "symbol_out_of_scope",
        chartObjects: [],
        plan: null,
        servedAt: new Date().toISOString(),
      });
    }
    const profile = await context.service.from("ht_agent_profiles")
      .select("id,kill_switch,status")
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (profile.error) throw profile.error;
    if (!profile.data) {
      return response({ ok: true, symbol, rolloutMode, visible: true, unavailableReason: "no_current_plan", chartObjects: [], plan: null, servedAt: new Date().toISOString() });
    }
    const proxObjects = await loadLatestProxObjects({
      service: context.service,
      profileId: String(profile.data.id),
      symbol,
    });
    const root = await context.service.from("ht_agent_visual_plans")
      .select("id,active_version_id")
      .eq("profile_id", profile.data.id)
      .eq("symbol", symbol)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (root.error) throw root.error;
    if (!root.data?.active_version_id) {
      return response({ ok: true, symbol, rolloutMode, visible: true, unavailableReason: "no_current_plan", chartObjects: proxObjects, plan: null, servedAt: new Date().toISOString() });
    }
    const [version, state, events] = await Promise.all([
      context.service.from("ht_agent_visual_plan_versions")
        .select("id,version_number,definition,expires_at")
        .eq("id", root.data.active_version_id)
        .eq("profile_id", profile.data.id)
        .single(),
      context.service.from("ht_agent_visual_plan_states")
        .select("lifecycle_state,state_provider_timestamp,last_evaluated_candle_at")
        .eq("plan_version_id", root.data.active_version_id)
        .eq("profile_id", profile.data.id)
        .single(),
      context.service.from("ht_agent_visual_plan_events")
        .select("id,to_state,event_type,provider_timestamp,price")
        .eq("plan_version_id", root.data.active_version_id)
        .eq("profile_id", profile.data.id)
        .order("transition_version", { ascending: true }),
    ]);
    if (version.error) throw version.error;
    if (state.error) throw state.error;
    if (events.error) throw events.error;
    const definition = version.data.definition as AgentXVisualPlanDefinition;
    if (definition?.schemaVersion !== HT_AGENT_VISUAL_PLAN_VERSION) {
      throw new Error("Agent X visual plan schema is unsupported.");
    }
    const lifecycleState = String(state.data.lifecycle_state) as AgentPlanLifecycleState;
    const status = objectStatus(lifecycleState);
    const agentObjects = (Array.isArray(definition.chartObjects) ? definition.chartObjects : [])
      .filter(isHtChartObject)
      .filter((object) => object.authority === "agent")
      .map((object): HtChartObject => ({
        ...object,
        status,
        timing: {
          ...object.timing,
          freshness: visualPlanObjectFreshness(object.timing.marketEvidenceAt),
        },
      }));
    const eventObjects = (events.data ?? []).flatMap((event): HtChartObject[] => {
      if (event.event_type === "plan_created") return [];
      const role = ({
        entry_triggered: "triggered",
        target_reached: "target_reached",
        plan_invalidated: "invalidated",
        plan_expired: "expired",
        price_order_ambiguous: "needs_review",
      } as const)[event.event_type as "entry_triggered" | "target_reached" | "plan_invalidated" | "plan_expired" | "price_order_ambiguous"];
      if (!role) return [];
      const eventStatus = objectStatus(String(event.to_state) as AgentPlanLifecycleState);
      return [{
        id: String(event.id),
        schemaVersion: "ht-chart-object-v1",
        authority: "agent",
        type: "event_marker",
        role,
        symbol,
        status: eventStatus,
        label: role.replaceAll("_", " "),
        providerTimestamp: String(event.provider_timestamp),
        price: event.price === null ? null : Number(event.price),
        source: { kind: "plan_lifecycle_event", id: String(event.id), version: "agent-x-plan-lifecycle-v1-provider-minute" },
        timing: {
          marketEvidenceAt: String(event.provider_timestamp),
          sourceComputedAt: null,
          session: definition.chartObjects[0]?.timing.session ?? "regular",
          evidenceInterval: "1m",
          freshness: visualPlanObjectFreshness(String(event.provider_timestamp)),
        },
        confidence: { value: null, authority: null },
      }];
    });
    const active = lifecycleState === "watching" || lifecycleState === "triggered";
    const handoffEnabled = control.data.visual_plan_paper_handoff_enabled === true;
    const killSwitch = control.data.kill_switch === true || profile.data.kill_switch === true || profile.data.status !== "active";
    const timeCurrent = Date.parse(String(version.data.expires_at)) > Date.now();
    const paperHandoffEligible = active && handoffEnabled && !killSwitch && timeCurrent;
    const currentChartObjects = [...agentObjects, ...proxObjects, ...eventObjects];
    return response({
      ok: true,
      symbol,
      rolloutMode,
      visible: true,
      unavailableReason: null,
      chartObjects: currentChartObjects,
      plan: {
        planId: String(root.data.id),
        planVersionId: String(version.data.id),
        versionNumber: Number(version.data.version_number),
        lifecycleState,
        stateProviderTimestamp: String(state.data.state_provider_timestamp),
        lastEvaluatedCandleAt: state.data.last_evaluated_candle_at ? String(state.data.last_evaluated_candle_at) : null,
        definition,
        chartObjects: currentChartObjects,
        paperHandoffEligible,
        paperHandoffReason: paperHandoffEligible ? null : !handoffEnabled ? "paper_handoff_disabled" : killSwitch ? "agent_kill_switch" : !timeCurrent ? "plan_expired" : lifecycleState,
      },
      servedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ht-agent-plans] read failed", error);
    return response({ ok: false, error: "Agent X visual plans are not ready. Confirm migrations 0052 and 0053." }, 503);
  }
}
