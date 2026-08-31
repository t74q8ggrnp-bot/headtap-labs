// app/api/prox-shadow-board-outcomes/route.ts
//
// Measures what actually happened after each independent ProX shadow-board
// decision. Every horizon is resolved from a verified historical minute bar
// near its own target timestamp. A missing bar stays pending until it is old
// enough to be terminally unavailable; it is never converted into a zero
// return. Shadow/research-only: nothing here changes canonical ranking,
// eligibility, a public score, or execution authority.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import {
  computeProxReturnPercent,
  getProxEpisodeHorizonTargets,
  PROX_SHADOW_BOARD_OUTCOMES_VERSION,
  type ProxOutcomeHorizon,
} from "@/lib/prox/outcome-memory";
import {
  normalizeProxOutcomeBars,
  resolveProxOutcomeHorizon,
  summarizeProxOutcomePath,
  type ProxOutcomeBar,
} from "@/lib/prox/shadow-outcome-resolution";
import { selectDueOutcomeMemberIds } from "@/lib/prox/shadow-outcome-scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const POLYGON_AGGREGATES_ORIGIN = "https://api.polygon.io/v2/aggs/ticker";
const ACTIVE_MEMBER_BATCH_LIMIT = 1200;
const DUE_HORIZON_BATCH_LIMIT = 4000;
const TICKER_BATCH_LIMIT = 40;
const POLYGON_FETCH_CONCURRENCY = 5;
const WRITE_BATCH_SIZE = 100;

type MemberOutcomeRow = {
  id: string;
  member_id: string;
  ticker: string;
  trading_date: string;
  market_session: "pre_market" | "regular" | "after_hours" | "closed";
  decision_at: string;
  entry_price: number;
  latest_price: number;
  latest_observed_at: string;
  sampled_high_price: number;
  sampled_high_at: string;
  sampled_low_price: number;
  sampled_low_at: string;
  max_gain_percent: number;
  max_drawdown_percent: number;
  time_to_peak_minutes: number;
  status: "active" | "complete";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type HorizonRow = {
  id?: string;
  member_outcome_id: string;
  horizon: ProxOutcomeHorizon;
  target_at: string;
  measured_at: string | null;
  measured_price: number | null;
  return_percent: number | null;
  complete: boolean;
  resolution_state?: "pending" | "measured" | "unavailable";
  unavailable_reason?: string | null;
};

type PolygonAggregateRow = {
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing server-side Supabase service credentials.");
  }
  return createClient(url, key);
}

function isAuthorized(request: Request) {
  if (!CRON_SECRET) return false;
  return request.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function observationMinute(date: Date) {
  const minute = new Date(date);
  minute.setUTCSeconds(0, 0);
  return minute.toISOString();
}

function isoDate(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ProX outcome timestamp: ${String(value)}`);
  }
  return parsed.toISOString().slice(0, 10);
}

async function fetchPolygonMinuteBars({
  ticker,
  from,
  to,
}: {
  ticker: string;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams({
    adjusted: "true",
    sort: "asc",
    limit: "50000",
    apiKey: POLYGON_KEY ?? "",
  });
  const response = await fetch(
    `${POLYGON_AGGREGATES_ORIGIN}/${encodeURIComponent(ticker)}` +
      `/range/1/minute/${from}/${to}?${params.toString()}`,
    { cache: "no-store", signal: AbortSignal.timeout(25_000) },
  );
  if (!response.ok) {
    throw new Error(
      `Polygon historical bars failed for ${ticker}: ${response.status}`,
    );
  }
  const payload = (await response.json()) as { results?: PolygonAggregateRow[] };
  return normalizeProxOutcomeBars(
    (payload.results ?? []).map(
      (row): ProxOutcomeBar => ({
        timeMs: finiteNumber(row.t),
        open: finiteNumber(row.o),
        high: finiteNumber(row.h),
        low: finiteNumber(row.l),
        close: finiteNumber(row.c),
      }),
    ),
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

async function writeInBatches(
  rows: Array<Record<string, unknown>>,
  writer: (
    batch: Array<Record<string, unknown>>,
  ) => Promise<{ error: { message: string } | null }>,
) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    const result = await writer(rows.slice(index, index + WRITE_BATCH_SIZE));
    if (result.error) throw new Error(result.error.message);
  }
}

async function ensureMemberHorizons(
  supabase: ReturnType<typeof getSupabase>,
  members: MemberOutcomeRow[],
) {
  const rows = members.flatMap((member) =>
    getProxEpisodeHorizonTargets({
      startedAt: member.decision_at,
      tradingDate: member.trading_date,
      marketSession: member.market_session,
    }).map((target) => ({
      member_outcome_id: member.id,
      horizon: target.horizon,
      target_at: target.targetAt,
      complete: false,
    })),
  );
  await writeInBatches(rows, async (batch) => {
    const { error } = await supabase
      .from("prox_shadow_board_member_outcome_horizons")
      .upsert(batch, {
        onConflict: "member_outcome_id,horizon",
        ignoreDuplicates: true,
      });
    return { error };
  });
}

async function readMemberHorizons(
  supabase: ReturnType<typeof getSupabase>,
  memberOutcomeIds: string[],
) {
  const rows: HorizonRow[] = [];
  const batchSize = 200;
  for (let index = 0; index < memberOutcomeIds.length; index += batchSize) {
    const { data, error } = await supabase
      .from("prox_shadow_board_member_outcome_horizons")
      .select("*")
      .in("member_outcome_id", memberOutcomeIds.slice(index, index + batchSize));
    if (error) throw error;
    rows.push(...((data ?? []) as HorizonRow[]));
  }
  return rows;
}

async function readActiveMembersById(
  supabase: ReturnType<typeof getSupabase>,
  memberOutcomeIds: string[],
) {
  const rows: MemberOutcomeRow[] = [];
  const batchSize = 200;
  for (let index = 0; index < memberOutcomeIds.length; index += batchSize) {
    const { data, error } = await supabase
      .from("prox_shadow_board_member_outcomes")
      .select("*")
      .eq("status", "active")
      .in("id", memberOutcomeIds.slice(index, index + batchSize));
    if (error) throw error;
    rows.push(...((data ?? []) as MemberOutcomeRow[]));
  }
  const dueOrder = new Map(
    memberOutcomeIds.map((id, index) => [id, index]),
  );
  return rows.sort(
    (left, right) =>
      (dueOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (dueOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function isTerminalHorizon(horizon: HorizonRow) {
  if (!horizon.complete) return false;
  return (
    horizon.resolution_state === "unavailable" ||
    horizon.resolution_state === "measured" ||
    (horizon.resolution_state === undefined && horizon.return_percent !== null)
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!POLYGON_KEY) {
    return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });
  }

  const supabase = getSupabase();
  const now = new Date();
  const observedAt = now.toISOString();
  const minute = observationMinute(now);
  let runId: string | null = null;

  const { data: run, error: runError } = await supabase
    .from("prox_shadow_board_outcome_runs")
    .insert({
      observed_at: observedAt,
      observation_minute: minute,
      engine_version: PROX_SHADOW_BOARD_OUTCOMES_VERSION,
      status: "running",
    })
    .select("id")
    .single();
  if (runError || !run?.id) {
    if (runError?.code === "23505") {
      const { data: existing } = await supabase
        .from("prox_shadow_board_outcome_runs")
        .select("id,status,complete,completed_at")
        .eq("observation_minute", minute)
        .eq("engine_version", PROX_SHADOW_BOARD_OUTCOMES_VERSION)
        .maybeSingle();
      return NextResponse.json({
        success: existing?.status === "success",
        deduplicated: true,
        run: existing ?? null,
        authority: "shadow_research_only",
        timestamp: new Date().toISOString(),
      });
    }
    return NextResponse.json(
      {
        error:
          "ProX shadow-board outcomes schema is unavailable; run migrations 0020 and 0021.",
        detail: getErrorMessage(runError, "Unknown schema error."),
      },
      { status: 500 },
    );
  }
  runId = String(run.id);

  try {
    const { data: dueRows, error: dueError } = await supabase
      .from("prox_shadow_board_member_outcome_horizons")
      .select("member_outcome_id,target_at")
      .eq("complete", false)
      .lte("target_at", observedAt)
      .order("target_at", { ascending: true })
      .limit(DUE_HORIZON_BATCH_LIMIT);
    if (dueError) throw dueError;
    const dueMemberIds = selectDueOutcomeMemberIds(
      dueRows ?? [],
      ACTIVE_MEMBER_BATCH_LIMIT,
    );
    let activeMembers = await readActiveMembersById(
      supabase,
      dueMemberIds,
    );
    // A quiet cycle can still advance path highs/lows and seed any historical
    // parent rows that predate inline horizon creation. Due work always wins;
    // this fallback only runs when no due horizon exists at all.
    if (activeMembers.length === 0) {
      const { data, error: memberError } = await supabase
        .from("prox_shadow_board_member_outcomes")
        .select("*")
        .eq("status", "active")
        .order("latest_observed_at", { ascending: true })
        .order("decision_at", { ascending: true })
        .limit(ACTIVE_MEMBER_BATCH_LIMIT);
      if (memberError) throw memberError;
      activeMembers = (data ?? []) as MemberOutcomeRow[];
    }

    const selectedTickers = new Set<string>();
    for (const member of activeMembers) {
      if (selectedTickers.size >= TICKER_BATCH_LIMIT) break;
      selectedTickers.add(member.ticker.toUpperCase());
    }
    const members = activeMembers.filter((member) =>
      selectedTickers.has(member.ticker.toUpperCase()),
    );

    await ensureMemberHorizons(supabase, members);
    const horizonRows = await readMemberHorizons(
      supabase,
      members.map((member) => member.id),
    );
    const horizonsByMember = new Map<string, HorizonRow[]>();
    for (const horizon of horizonRows) {
      const group = horizonsByMember.get(horizon.member_outcome_id) ?? [];
      group.push(horizon);
      horizonsByMember.set(horizon.member_outcome_id, group);
    }

    const earliestDecisionByTicker = new Map<string, string>();
    for (const member of members) {
      const ticker = member.ticker.toUpperCase();
      const existing = earliestDecisionByTicker.get(ticker);
      if (!existing || member.decision_at < existing) {
        earliestDecisionByTicker.set(ticker, member.decision_at);
      }
    }
    const tickerBars = new Map<string, ProxOutcomeBar[]>();
    const providerFailures: Array<{ ticker: string; message: string }> = [];
    await mapWithConcurrency(
      [...selectedTickers],
      POLYGON_FETCH_CONCURRENCY,
      async (ticker) => {
        try {
          const bars = await fetchPolygonMinuteBars({
            ticker,
            from: isoDate(earliestDecisionByTicker.get(ticker) ?? observedAt),
            to: isoDate(now),
          });
          tickerBars.set(ticker, bars);
        } catch (error: unknown) {
          // A single halted, delisted, malformed, or temporarily unavailable
          // symbol must not erase the complete denominator for every other
          // ProX decision in this cycle. Its horizons remain pending and are
          // retried; the provider failure stays explicit in diagnostics.
          providerFailures.push({
            ticker,
            message: getErrorMessage(
              error,
              `Polygon historical bars failed for ${ticker}.`,
            ),
          });
        }
      },
    );

    if (selectedTickers.size > 0 && tickerBars.size === 0) {
      throw new Error(
        `Polygon historical bars were unavailable for all ${selectedTickers.size} selected outcome tickers.`,
      );
    }

    const memberUpdates: Array<Record<string, unknown>> = [];
    const dueHorizonUpdates: Array<Record<string, unknown>> = [];
    let dueOutcomeCount = 0;
    let unavailableOutcomeCount = 0;
    let terminalUnavailableCount = 0;
    let deferredOutcomeCount = 0;
    let updatedMemberCount = 0;

    for (const member of members) {
      const bars = tickerBars.get(member.ticker.toUpperCase()) ?? [];
      const memberHorizons = horizonsByMember.get(member.id) ?? [];
      const dueHorizons = memberHorizons.filter(
        (horizon) =>
          !horizon.complete && new Date(horizon.target_at).getTime() <= now.getTime(),
      );
      dueOutcomeCount += dueHorizons.length;

      const terminalByHorizon = new Map<ProxOutcomeHorizon, boolean>();
      for (const horizon of memberHorizons) {
        terminalByHorizon.set(horizon.horizon, isTerminalHorizon(horizon));
      }

      const entryPrice = positiveNumber(member.entry_price);
      if (entryPrice === null) {
        throw new Error(`Invalid ProX entry price for ${member.ticker}.`);
      }

      for (const horizon of dueHorizons) {
        const resolved = resolveProxOutcomeHorizon({
          horizon: horizon.horizon,
          targetAt: horizon.target_at,
          bars,
          now,
        });
        if (resolved.state === "measured" && resolved.measuredPrice !== null) {
          const returnPercent = computeProxReturnPercent(
            entryPrice,
            resolved.measuredPrice,
          );
          if (returnPercent === null) {
            throw new Error(`Invalid ProX horizon return for ${member.ticker}.`);
          }
          dueHorizonUpdates.push({
            member_outcome_id: member.id,
            horizon: horizon.horizon,
            target_at: horizon.target_at,
            measured_at: resolved.measuredAt,
            measured_price: resolved.measuredPrice,
            return_percent: returnPercent,
            complete: true,
            resolution_state: "measured",
            unavailable_reason: null,
            updated_at: observedAt,
          });
          terminalByHorizon.set(horizon.horizon, true);
        } else if (resolved.state === "unavailable") {
          dueHorizonUpdates.push({
            member_outcome_id: member.id,
            horizon: horizon.horizon,
            target_at: horizon.target_at,
            measured_at: null,
            measured_price: null,
            return_percent: null,
            complete: true,
            resolution_state: "unavailable",
            unavailable_reason: resolved.unavailableReason,
            updated_at: observedAt,
          });
          terminalByHorizon.set(horizon.horizon, true);
          unavailableOutcomeCount += 1;
          terminalUnavailableCount += 1;
        } else {
          unavailableOutcomeCount += 1;
          deferredOutcomeCount += 1;
        }
      }

      const path = summarizeProxOutcomePath({
        bars,
        entryPrice,
        decisionAt: member.decision_at,
        through: now,
      });
      if (path) updatedMemberCount += 1;

      const previousHigh = positiveNumber(member.sampled_high_price) ?? entryPrice;
      const previousLow = positiveNumber(member.sampled_low_price) ?? entryPrice;
      const pathHigh = path?.highest.high ?? previousHigh;
      const pathLow = path?.lowest.low ?? previousLow;
      const newHigh = Math.max(previousHigh, pathHigh);
      const newLow = Math.min(previousLow, pathLow);
      const sampledHighAt =
        path && path.highest.high > previousHigh
          ? new Date(path.highest.timeMs).toISOString()
          : member.sampled_high_at;
      const sampledLowAt =
        path && path.lowest.low < previousLow
          ? new Date(path.lowest.timeMs).toISOString()
          : member.sampled_low_at;
      const finalHorizonsComplete =
        terminalByHorizon.get("24h") === true &&
        terminalByHorizon.get("next_session") === true;

      if (path || finalHorizonsComplete) {
        const latestBarIsNewer =
          path && path.latest.timeMs >= new Date(member.latest_observed_at).getTime();
        memberUpdates.push({
          // Keep the complete existing row in the upsert. A partial row with
          // only the primary key and changed measurements violates the table's
          // required member/ticker/decision columns before ON CONFLICT can
          // update the existing record.
          ...member,
          latest_price: latestBarIsNewer ? path.latest.close : member.latest_price,
          latest_observed_at: latestBarIsNewer
            ? new Date(path.latest.timeMs).toISOString()
            : member.latest_observed_at,
          sampled_high_price: newHigh,
          sampled_high_at: sampledHighAt,
          sampled_low_price: newLow,
          sampled_low_at: sampledLowAt,
          max_gain_percent:
            computeProxReturnPercent(entryPrice, newHigh) ??
            finiteNumber(member.max_gain_percent),
          max_drawdown_percent:
            computeProxReturnPercent(entryPrice, newLow) ??
            finiteNumber(member.max_drawdown_percent),
          time_to_peak_minutes: Math.max(
            0,
            Number(
              (
                (new Date(sampledHighAt).getTime() -
                  new Date(member.decision_at).getTime()) /
                60_000
              ).toFixed(1),
            ),
          ),
          status: finalHorizonsComplete ? "complete" : "active",
          completed_at: finalHorizonsComplete ? observedAt : null,
          updated_at: observedAt,
        });
      }
    }

    await writeInBatches(dueHorizonUpdates, async (batch) => {
      const { error } = await supabase
        .from("prox_shadow_board_member_outcome_horizons")
        .upsert(batch, { onConflict: "member_outcome_id,horizon" });
      return { error };
    });
    await writeInBatches(memberUpdates, async (batch) => {
      const { error } = await supabase
        .from("prox_shadow_board_member_outcomes")
        .upsert(batch, { onConflict: "id" });
      return { error };
    });

    const persistedOutcomeCount = dueHorizonUpdates.length;
    const complete =
      dueOutcomeCount === persistedOutcomeCount + deferredOutcomeCount;
    const completedAt = new Date().toISOString();
    const diagnostics = {
      authority: "shadow_research_only",
      priceAuthority: "polygon_historical_minute_bars",
      engineVersion: PROX_SHADOW_BOARD_OUTCOMES_VERSION,
      dueHorizonSelectionCount: dueRows?.length ?? 0,
      dueMemberSelectionCount: dueMemberIds.length,
      activeMemberBatchCount: activeMembers.length,
      processedMemberCount: members.length,
      selectedTickerCount: selectedTickers.size,
      providerSuccessCount: tickerBars.size,
      providerFailureCount: providerFailures.length,
      providerFailures,
      historicalBarCount: [...tickerBars.values()].reduce(
        (sum, bars) => sum + bars.length,
        0,
      ),
      deferredOutcomeCount,
      terminalUnavailableCount,
      noPublicScore: true,
      noExecutionAuthority: true,
    };
    const { error: completionError } = await supabase
      .from("prox_shadow_board_outcome_runs")
      .update({
        status: complete ? "success" : "failed",
        active_member_count: members.length,
        updated_member_count: updatedMemberCount,
        due_outcome_count: dueOutcomeCount,
        persisted_outcome_count: persistedOutcomeCount,
        unavailable_outcome_count: unavailableOutcomeCount,
        complete,
        diagnostics,
        error_message: complete ? null : "Outcome coverage mismatch.",
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", runId);
    if (completionError) throw completionError;

    return NextResponse.json({
      success: complete,
      authority: "shadow_research_only",
      diagnostics: {
        ...diagnostics,
        updatedMemberCount,
        dueOutcomeCount,
        persistedOutcomeCount,
        unavailableOutcomeCount,
      },
      timestamp: completedAt,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "ProX shadow-board outcomes failed.");
    console.error("[prox-shadow-board-outcomes] run failed:", message);
    if (runId) {
      await supabase
        .from("prox_shadow_board_outcome_runs")
        .update({
          status: "failed",
          complete: false,
          error_message: message,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return NextResponse.json(
      { error: message, authority: "shadow_research_only" },
      { status: 500 },
    );
  }
}
