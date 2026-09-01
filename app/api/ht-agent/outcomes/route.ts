import { NextResponse } from "next/server";
import { getPaperServiceClient } from "@/lib/paper-trading/server";
import {
  fetchMassiveHistoricalQuoteAtOrAfter,
  massiveStocksUrl,
} from "@/lib/massive-stocks";
import {
  findProxOutcomeBarAtTarget,
  isUsExtendedMarketTimestamp,
  normalizeProxOutcomeBars,
  PROX_OUTCOME_BAR_TOLERANCE_MS,
  PROX_OUTCOME_UNAVAILABLE_AFTER_MS,
  type ProxOutcomeBar,
} from "@/lib/prox/shadow-outcome-resolution";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DueOutcome = {
  id: string;
  target_at: string;
  ht_agent_decisions: { symbol: string; proposed_entry: number | string | null };
  ht_agent_cohort_observations: {
    cohort: string;
    would_enter: boolean;
    conservative_slippage_bps: number | string;
  };
};

type AggregatePayload = {
  results?: Array<{ t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown }>;
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
  const response = await fetch(massiveStocksUrl(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${Math.floor(fromMs)}/${Math.floor(toMs)}`,
    { adjusted: true, sort: "asc", limit: 50_000 },
  ), { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Massive historical bars failed for ${symbol}: ${response.status}`);
  const payload = await response.json() as AggregatePayload;
  return normalizeProxOutcomeBars((payload.results ?? []).map((bar): ProxOutcomeBar => ({
    timeMs: finite(bar.t),
    open: finite(bar.o),
    high: finite(bar.h),
    low: finite(bar.l),
    close: finite(bar.c),
  })));
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
  const due = await service.from("ht_agent_outcomes")
    .select("id,target_at,ht_agent_decisions!inner(symbol,proposed_entry),ht_agent_cohort_observations!inner(cohort,would_enter,conservative_slippage_bps)")
    .eq("complete", false)
    .lte("target_at", observedAt.toISOString())
    .order("target_at", { ascending: true })
    .limit(300);
  if (due.error) return NextResponse.json({ ok: false, error: due.error.message }, { status: 503 });

  const rows = (due.data ?? []) as unknown as DueOutcome[];
  const ranges = new Map<string, { fromMs: number; toMs: number }>();
  for (const row of rows) {
    const targetMs = Date.parse(row.target_at);
    const symbol = row.ht_agent_decisions.symbol;
    if (!Number.isFinite(targetMs)) continue;
    const existing = ranges.get(symbol);
    ranges.set(symbol, {
      fromMs: Math.min(existing?.fromMs ?? Infinity, targetMs - PROX_OUTCOME_BAR_TOLERANCE_MS),
      toMs: Math.max(existing?.toMs ?? 0, targetMs + PROX_OUTCOME_BAR_TOLERANCE_MS),
    });
  }
  const barsBySymbol = new Map<string, ProxOutcomeBar[]>();
  await mapWithConcurrency([...ranges.entries()], 10, async ([symbol, range]) => {
    try {
      barsBySymbol.set(symbol, await fetchHistoricalBars(symbol, range.fromMs, range.toMs));
    } catch {
      barsBySymbol.set(symbol, []);
    }
  });

  let completed = 0;
  let measured = 0;
  let unavailable = 0;
  let pending = 0;
  await mapWithConcurrency(rows, 10, async (row) => {
    const joined = row.ht_agent_decisions;
    const cohort = row.ht_agent_cohort_observations;
    const targetMs = Date.parse(row.target_at);
    const bar = findProxOutcomeBarAtTarget(barsBySymbol.get(joined.symbol) ?? [], row.target_at);
    if (!bar) {
      const ageMs = observedAt.getTime() - targetMs;
      const terminalReason = ageMs >= PROX_OUTCOME_BAR_TOLERANCE_MS && !isUsExtendedMarketTimestamp(row.target_at)
        ? "The U.S. equity market was closed at the target timestamp."
        : ageMs >= PROX_OUTCOME_UNAVAILABLE_AFTER_MS
          ? "No verified Massive market bar exists near the target timestamp."
          : null;
      if (!terminalReason) {
        pending += 1;
        return;
      }
      const update = await service.from("ht_agent_outcomes").update({
        observed_at: observedAt.toISOString(),
        resolution_state: "unavailable",
        unavailable_reason: terminalReason,
        complete: true,
      }).eq("id", row.id).eq("complete", false);
      if (update.error) throw update.error;
      completed += 1;
      unavailable += 1;
      return;
    }

    const nbbo = await fetchMassiveHistoricalQuoteAtOrAfter(joined.symbol, new Date(bar.timeMs));
    const entry = Number(joined.proposed_entry ?? 0);
    const rawReturn = entry > 0 ? (bar.close - entry) / entry * 100 : null;
    const conservativeReturn = rawReturn === null
      ? null
      : cohort.would_enter
        ? rawReturn - Number(cohort.conservative_slippage_bps ?? 0) / 100
        : rawReturn;
    const midpoint = nbbo?.bid && nbbo.ask ? (nbbo.bid + nbbo.ask) / 2 : null;
    const spread = midpoint && nbbo?.bid && nbbo.ask ? (nbbo.ask - nbbo.bid) / midpoint * 100 : null;
    const update = await service.from("ht_agent_outcomes").update({
      observed_at: observedAt.toISOString(),
      provider_timestamp: new Date(bar.timeMs).toISOString(),
      quote_provider_timestamp: nbbo?.timestamp ?? null,
      bid: nbbo?.bid ?? null,
      ask: nbbo?.ask ?? null,
      spread_percent: spread,
      price: bar.close,
      return_percent: conservativeReturn,
      resolution_state: "measured",
      unavailable_reason: null,
      complete: true,
    }).eq("id", row.id).eq("complete", false);
    if (update.error) throw update.error;
    completed += 1;
    measured += 1;
  });

  return NextResponse.json({
    ok: pending === 0,
    authority: "historical_massive_paper_research_only",
    due: rows.length,
    completed,
    measured,
    unavailable,
    pending,
    timestamp: observedAt.toISOString(),
  }, { status: pending === 0 ? 200 : 202 });
}
