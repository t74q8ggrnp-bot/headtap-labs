import { NextResponse } from "next/server";
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

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AggregatePayload = {
  results?: Array<{ t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown }>;
};

type ClaimPayload = {
  allowed?: unknown;
  reason?: unknown;
  rows?: unknown;
  claimed?: unknown;
  retiredAgentRuns?: unknown;
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
      }))),
      failed: false,
    };
  } catch {
    return { bars: [] as ProxOutcomeBar[], failed: true };
  }
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
    }));
    return NextResponse.json({
      ok: pending === 0 && failedSymbols.size === 0,
      authority: "historical_massive_paper_research_only",
      workerVersion: "ht-agent-outcome-worker-v2",
      due: rows.length,
      completed: updates.length,
      measured,
      unavailable,
      pending,
      providerBarRequests: ranges.size,
      providerBarFailures: failedSymbols.size,
      providerQuoteRequests: evidenceGroups.size,
      evidenceRowsReused: Math.max(0, measuredPlans.length - evidenceGroups.size),
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
