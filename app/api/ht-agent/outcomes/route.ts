import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getPaperServiceClient } from "@/lib/paper-trading/server";
import {
  fetchMassiveHistoricalQuoteAtOrAfter,
  massiveStocksUrl,
} from "@/lib/massive-stocks";
import {
  normalizeProxOutcomeBars,
  PROX_OUTCOME_BAR_TOLERANCE_MS,
  type ProxOutcomeBar,
} from "@/lib/prox/shadow-outcome-resolution";
import {
  buildHtAgentOutcomeUpdate,
  planHtAgentOutcomeBatch,
  type HtAgentDueOutcome,
  type HtAgentOutcomeUpdate,
} from "@/lib/ht-agent/outcome-batch";
import {
  evaluateAgentPlanMinute,
  type AgentPlanLifecycleSnapshot,
} from "@/lib/ht-agent/plan-lifecycle";
import {
  visualPlanReleaseContractMatches,
  type AgentPlanLifecycleState,
  type AgentXVisualPlanDefinition,
} from "@/lib/ht-agent/visual-plan";
import { HT_AGENT_VISUAL_PLAN_VERSION } from "@/lib/ht-agent/contracts";
import { marketChartPollingState } from "@/lib/market-chart-polling";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AggregatePayload = {
  results?: Array<{ t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown }>;
};

type ClaimPayload = {
  allowed?: unknown;
  reason?: unknown;
  rows?: unknown;
  claimed?: unknown;
  retiredAgentRuns?: unknown;
};

type VisualPlanClaim = {
  planVersionId: string;
  symbol: string;
  definition: AgentXVisualPlanDefinition;
  state: AgentPlanLifecycleState;
  stateVersion: number;
  lastEvaluatedCandleAt: string | null;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function fetchHistoricalBars(symbol: string, fromMs: number, toMs: number) {
  try {
    const response = await fetch(massiveStocksUrl(
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${Math.floor(fromMs)}/${Math.floor(toMs)}`,
      { adjusted: true, sort: "asc", limit: 50_000 },
    ), { cache: "no-store", signal: AbortSignal.timeout(25_000) });
    if (!response.ok) return { bars: [] as ProxOutcomeBar[], failed: true };
    const payload = await response.json() as AggregatePayload;
    return {
      bars: normalizeProxOutcomeBars((payload.results ?? []).map((bar): ProxOutcomeBar => ({
        timeMs: finite(bar.t),
        open: finite(bar.o),
        high: finite(bar.h),
        low: finite(bar.l),
        close: finite(bar.c),
        volume: finite(bar.v),
      }))),
      failed: false,
    };
  } catch {
    return { bars: [] as ProxOutcomeBar[], failed: true };
  }
}

function parseVisualPlanClaims(value: unknown): VisualPlanClaim[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { plans?: unknown }).plans;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw): VisualPlanClaim[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const definition = row.definition as AgentXVisualPlanDefinition;
    const state = String(row.state) as AgentPlanLifecycleState;
    if (
      typeof row.planVersionId !== "string" ||
      typeof row.symbol !== "string" ||
      definition?.schemaVersion !== HT_AGENT_VISUAL_PLAN_VERSION ||
      !visualPlanReleaseContractMatches(definition) ||
      !["watching", "triggered"].includes(state) ||
      !Number.isInteger(Number(row.stateVersion))
    ) return [];
    return [{
      planVersionId: row.planVersionId,
      symbol: row.symbol,
      definition,
      state,
      stateVersion: Number(row.stateVersion),
      lastEvaluatedCandleAt: typeof row.lastEvaluatedCandleAt === "string"
        ? row.lastEvaluatedCandleAt
        : null,
    }];
  });
}

function evidenceHash(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<void>,
) {
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await mapper(values[index]);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const service = getPaperServiceClient();
  const observedAt = new Date();
  const visualLifecyclePolling = marketChartPollingState(observedAt, "extended");
  const startedAt = Date.now();
  const workerId = crypto.randomUUID();
  const claim = await service.rpc("ht_agent_claim_outcome_batch", {
    p_worker_id: workerId,
    p_limit: 900,
  });
  if (claim.error) return NextResponse.json({
    ok: false,
    error: "HT Agent outcome worker migration 0046 is unavailable.",
  }, { status: 503 });
  const payload = claim.data && typeof claim.data === "object"
    ? claim.data as ClaimPayload
    : null;
  if (payload?.allowed !== true) {
    return NextResponse.json({
      ok: true,
      authority: "historical_massive_paper_research_only",
      state: payload?.reason === "worker_in_progress" ? "worker_in_progress" : "not_started",
      due: 0,
      completed: 0,
      measured: 0,
      unavailable: 0,
      pending: 0,
      timestamp: observedAt.toISOString(),
    }, { status: 202 });
  }
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).filter((value): value is HtAgentDueOutcome => {
    if (!value || typeof value !== "object") return false;
    const row = value as Partial<HtAgentDueOutcome>;
    return typeof row.id === "string" && typeof row.targetAt === "string" &&
      typeof row.symbol === "string" && typeof row.cohort === "string" &&
      typeof row.wouldEnter === "boolean" && Number.isFinite(Number(row.conservativeSlippageBps));
  }).map((row) => ({
    ...row,
    proposedEntry: row.proposedEntry === null ? null : finite(row.proposedEntry),
    conservativeSlippageBps: finite(row.conservativeSlippageBps),
  }));
  // Lifecycle evidence is provider-market evidence, so no visual-plan claim or
  // provider request is allowed outside the known extended-hours calendar.
  const visualClaimResult = visualLifecyclePolling.active
    ? await service.rpc("ht_agent_claim_visual_plan_batch", { p_limit: 50 })
    : { data: { allowed: false, reason: visualLifecyclePolling.reason, plans: [] }, error: null };
  const visualClaims = visualClaimResult.error ? [] : parseVisualPlanClaims(visualClaimResult.data);
  const ranges = new Map<string, { fromMs: number; toMs: number }>();
  for (const row of rows) {
    const targetMs = Date.parse(row.targetAt);
    const symbol = row.symbol;
    if (!Number.isFinite(targetMs)) continue;
    const existing = ranges.get(symbol);
    ranges.set(symbol, {
      fromMs: Math.min(existing?.fromMs ?? Infinity, targetMs - PROX_OUTCOME_BAR_TOLERANCE_MS),
      toMs: Math.max(existing?.toMs ?? 0, targetMs + PROX_OUTCOME_BAR_TOLERANCE_MS),
    });
  }
  const outcomeRangeSymbols = new Set(ranges.keys());
  const visualSymbols = new Set(visualClaims.map((plan) => plan.symbol));
  const visualProviderRequestCount = [...visualSymbols].filter((symbol) => !outcomeRangeSymbols.has(symbol)).length;
  for (const plan of visualClaims) {
    const fromMs = Date.parse(plan.lastEvaluatedCandleAt ?? plan.definition.validFrom);
    if (!Number.isFinite(fromMs)) continue;
    const existing = ranges.get(plan.symbol);
    ranges.set(plan.symbol, {
      fromMs: Math.min(existing?.fromMs ?? Infinity, fromMs),
      toMs: Math.max(existing?.toMs ?? 0, observedAt.getTime()),
    });
  }
  const barsBySymbol = new Map<string, ProxOutcomeBar[]>();
  const failedSymbols = new Set<string>();
  try {
    await mapWithConcurrency([...ranges.entries()], 6, async ([symbol, range]) => {
      const result = await fetchHistoricalBars(symbol, range.fromMs, range.toMs);
      barsBySymbol.set(symbol, result.bars);
      if (result.failed) failedSymbols.add(symbol);
    });
    const plans = planHtAgentOutcomeBatch({ rows, barsBySymbol, failedSymbols, observedAt });
    const measuredPlans = plans.filter((plan) => plan.state === "measured");
    const evidenceGroups = new Map(measuredPlans.map((plan) => [plan.evidenceKey, plan]));
    const nbboByEvidence = new Map<string, Awaited<ReturnType<typeof fetchMassiveHistoricalQuoteAtOrAfter>>>();
    await mapWithConcurrency([...evidenceGroups.entries()], 10, async ([key, plan]) => {
      nbboByEvidence.set(key, await fetchMassiveHistoricalQuoteAtOrAfter(
        plan.row.symbol,
        new Date(plan.bar.timeMs),
      ));
    });
    const updates = plans.flatMap((plan): HtAgentOutcomeUpdate[] => plan.state === "pending"
      ? []
      : [buildHtAgentOutcomeUpdate(
          plan,
          observedAt,
          plan.state === "measured" ? nbboByEvidence.get(plan.evidenceKey) ?? null : null,
        )]);
    const measured = updates.filter((update) => update.resolutionState === "measured").length;
    const unavailable = updates.length - measured;
    const pending = rows.length - updates.length;
    let visualEvidenceAccepted = 0;
    let visualTransitions = 0;
    const transitionCounts: Record<string, number> = {};
    for (const claimed of visualClaims) {
      let snapshot: AgentPlanLifecycleSnapshot & { symbol: string } = {
        symbol: claimed.symbol,
        state: claimed.state,
        stateVersion: claimed.stateVersion,
        validFrom: claimed.definition.validFrom,
        expiresAt: claimed.definition.expiresAt,
        lastEvaluatedCandleAt: claimed.lastEvaluatedCandleAt,
        entryCondition: claimed.definition.entryCondition,
        triggerPrice: claimed.definition.triggerPrice,
        stopPrice: claimed.definition.stopPrice,
        targetOne: claimed.definition.targetOne,
        targetTwo: claimed.definition.targetTwo,
        cancellation: claimed.definition.cancellation,
      };
      const bars = barsBySymbol.get(claimed.symbol) ?? [];
      for (const bar of bars) {
        const closedAtMs = bar.timeMs + 60_000;
        if (closedAtMs > observedAt.getTime()) continue;
        const evidenceBase = {
          symbol: claimed.symbol,
          openedAt: new Date(bar.timeMs).toISOString(),
          closedAt: new Date(closedAtMs).toISOString(),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume ?? 0,
          source: "massive_polygon_minute_aggregate" as const,
        };
        const evaluation = evaluateAgentPlanMinute(snapshot, evidenceBase);
        if (evaluation.kind === "ignored" || evaluation.kind === "rejected") continue;
        const evidence = { ...evidenceBase, evidenceHash: evidenceHash(evidenceBase) };
        const applied = await service.rpc("ht_agent_apply_visual_plan_lifecycle", {
          p_plan_version_id: claimed.planVersionId,
          p_expected_state_version: snapshot.stateVersion,
          p_evidence: evidence,
          p_result: evaluation,
        });
        if (applied.error) throw applied.error;
        visualEvidenceAccepted += 1;
        snapshot = {
          ...snapshot,
          state: evaluation.kind === "transition" ? evaluation.to : snapshot.state,
          stateVersion: snapshot.stateVersion + 1,
          lastEvaluatedCandleAt: evidence.closedAt,
        };
        if (evaluation.kind === "transition") {
          visualTransitions += 1;
          transitionCounts[evaluation.to] = (transitionCounts[evaluation.to] ?? 0) + 1;
          if (!["watching", "triggered"].includes(evaluation.to)) break;
        }
      }
    }
    if (!visualClaimResult.error) {
      const visualRunPayload = {
        worker_id: workerId,
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
        claimed_plan_count: visualClaims.length,
        unique_symbol_count: new Set(visualClaims.map((plan) => plan.symbol)).size,
        provider_request_count: visualProviderRequestCount,
        accepted_evidence_count: visualEvidenceAccepted,
        transition_counts: transitionCounts,
        lifecycle_session: visualLifecyclePolling.active ? "active" : "closed",
        closed_market_skipped: !visualLifecyclePolling.active,
        reused_provider_request_count: [...visualSymbols].filter((symbol) => outcomeRangeSymbols.has(symbol)).length,
      };
      let visualRun = await service.from("ht_agent_visual_plan_worker_runs").insert(visualRunPayload);
      // Keep the already-deployed Phase 2 infrastructure operational during
      // the short code-before-forward-migration release window.
      if (["PGRST204", "42703"].includes(visualRun.error?.code ?? "")) {
        const legacyPayload = {
          worker_id: visualRunPayload.worker_id,
          started_at: visualRunPayload.started_at,
          completed_at: visualRunPayload.completed_at,
          status: visualRunPayload.status,
          claimed_plan_count: visualRunPayload.claimed_plan_count,
          unique_symbol_count: visualRunPayload.unique_symbol_count,
          provider_request_count: visualRunPayload.provider_request_count,
          accepted_evidence_count: visualRunPayload.accepted_evidence_count,
          transition_counts: visualRunPayload.transition_counts,
        };
        visualRun = await service.from("ht_agent_visual_plan_worker_runs").insert(legacyPayload);
      }
      if (visualRun.error) throw visualRun.error;
    }
    const finish = await service.rpc("ht_agent_finish_outcome_batch", {
      p_worker_id: workerId,
      p_updates: updates.map((update) => ({
        id: update.id,
        observed_at: update.observedAt,
        provider_timestamp: update.providerTimestamp,
        quote_provider_timestamp: update.quoteProviderTimestamp,
        bid: update.bid,
        ask: update.ask,
        spread_percent: update.spreadPercent,
        price: update.price,
        return_percent: update.returnPercent,
        resolution_state: update.resolutionState,
        unavailable_reason: update.unavailableReason,
      })),
      p_summary: {
        measured,
        unavailable,
        pending,
        providerBarRequests: ranges.size,
        providerBarFailures: failedSymbols.size,
        providerQuoteRequests: evidenceGroups.size,
        evidenceRowsReused: Math.max(0, measuredPlans.length - evidenceGroups.size),
        elapsedMs: Date.now() - startedAt,
        visualPlanClaims: visualClaims.length,
        visualPlanEvidenceAccepted: visualEvidenceAccepted,
        visualPlanTransitions: visualTransitions,
        visualPlanProviderRequests: visualProviderRequestCount,
        visualPlanLifecycleSession: visualLifecyclePolling.active ? "active" : "closed",
        visualPlanClosedMarketSkipped: !visualLifecyclePolling.active,
      },
    });
    if (finish.error) throw finish.error;
    console.info("[ht-agent-outcomes]", JSON.stringify({
      claimed: rows.length,
      completed: updates.length,
      measured,
      unavailable,
      pending,
      providerBarRequests: ranges.size,
      providerBarFailures: failedSymbols.size,
      providerQuoteRequests: evidenceGroups.size,
      evidenceRowsReused: Math.max(0, measuredPlans.length - evidenceGroups.size),
      retiredAgentRuns: finite(payload.retiredAgentRuns),
      elapsedMs: Date.now() - startedAt,
      visualPlanClaims: visualClaims.length,
      visualPlanEvidenceAccepted: visualEvidenceAccepted,
      visualPlanTransitions: visualTransitions,
      visualPlanProviderRequests: visualProviderRequestCount,
      visualPlanLifecycleSession: visualLifecyclePolling.active ? "active" : "closed",
      visualPlanClosedMarketSkipped: !visualLifecyclePolling.active,
    }));
    return NextResponse.json({
      ok: pending === 0 && failedSymbols.size === 0,
      authority: "historical_massive_paper_research_only",
      workerVersion: "ht-agent-outcome-worker-v3-phase2-release",
      due: rows.length,
      completed: updates.length,
      measured,
      unavailable,
      pending,
      providerBarRequests: ranges.size,
      providerBarFailures: failedSymbols.size,
      providerQuoteRequests: evidenceGroups.size,
      evidenceRowsReused: Math.max(0, measuredPlans.length - evidenceGroups.size),
      visualPlanClaims: visualClaims.length,
      visualPlanEvidenceAccepted: visualEvidenceAccepted,
      visualPlanTransitions: visualTransitions,
      visualPlanProviderRequests: visualProviderRequestCount,
      visualPlanLifecycleSession: visualLifecyclePolling.active ? "active" : "closed",
      visualPlanClosedMarketSkipped: !visualLifecyclePolling.active,
      timestamp: observedAt.toISOString(),
    }, { status: pending === 0 && failedSymbols.size === 0 ? 200 : 202 });
  } catch (error) {
    await service.rpc("ht_agent_finish_outcome_batch", {
      p_worker_id: workerId,
      p_updates: [],
      p_summary: {
        failed: true,
        pending: rows.length,
        providerBarFailures: failedSymbols.size,
        elapsedMs: Date.now() - startedAt,
      },
    });
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "HT Agent outcome batch failed.",
    }, { status: 503 });
  }
}
