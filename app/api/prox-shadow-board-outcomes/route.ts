// app/api/prox-shadow-board-outcomes/route.ts
//
// Measures what actually happened after each ProX shadow-board decision.
// Mirrors app/api/prox-outcome-memory/route.ts's control flow exactly, but
// scoped to prox_shadow_board_member_outcomes (seeded inline by
// app/api/prox-shadow-board/route.ts) instead of prox_research_episodes.
// This route never creates parent rows, only horizon children and their
// resolution -- same division of responsibility as the outcome-memory
// route relative to prox-market-discovery.
//
// Shadow/research-only: no table here is a public score, canonical
// eligibility decision, position instruction, or execution signal.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import {
  resolveSnapshotPrice,
  resolveSnapshotTimestampMs,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import {
  getProxEpisodeHorizonTargets,
  computeProxReturnPercent,
  PROX_SHADOW_BOARD_OUTCOMES_VERSION,
  type ProxOutcomeHorizon,
} from "@/lib/prox/outcome-memory";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SNAPSHOT_ENDPOINT =
  "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers";
const ACTIVE_MEMBER_LIMIT = 2_000;
const WRITE_BATCH_SIZE = 100;

type MemberOutcomeRow = {
  id: string;
  ticker: string;
  trading_date: string;
  market_session: "pre_market" | "regular" | "after_hours" | "closed";
  decision_at: string;
  entry_price: number;
  latest_observed_at: string;
  sampled_high_price: number;
  sampled_high_at: string;
  sampled_low_price: number;
  sampled_low_at: string;
  status: "active" | "complete";
  [key: string]: unknown;
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

async function fetchPolygonSnapshot() {
  const response = await fetch(
    `${SNAPSHOT_ENDPOINT}?include_otc=false&apiKey=${POLYGON_KEY}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Polygon shadow-board-outcomes snapshot failed: ${response.status}`);
  }
  const payload = (await response.json()) as { tickers?: PolygonSnapshotRow[] };
  const rows = Array.isArray(payload.tickers) ? payload.tickers : [];
  if (rows.length === 0) {
    throw new Error("Polygon returned an empty shadow-board-outcomes snapshot.");
  }
  return rows;
}

function snapshotPriceMap(rows: PolygonSnapshotRow[]) {
  const map = new Map<string, { price: number; sourceTimestampMs: number | null }>();
  for (const row of rows) {
    const ticker = String(row.ticker ?? "").toUpperCase().trim();
    const price = resolveSnapshotPrice(row);
    if (ticker && price > 0) {
      map.set(ticker, { price, sourceTimestampMs: resolveSnapshotTimestampMs(row) });
    }
  }
  return map;
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
        error: "Pro X shadow-board outcomes schema is unavailable; run migration 0020.",
        detail: runError?.message ?? null,
      },
      { status: 500 },
    );
  }
  runId = String(run.id);

  try {
    const activeSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error: memberError } = await supabase
      .from("prox_shadow_board_member_outcomes")
      .select("*")
      .eq("status", "active")
      .gte("decision_at", activeSince)
      .order("decision_at", { ascending: true })
      .limit(ACTIVE_MEMBER_LIMIT);
    if (memberError) throw memberError;
    const members = (data ?? []) as MemberOutcomeRow[];
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

    const snapshot = members.length > 0 ? await fetchPolygonSnapshot() : [];
    const priceMap = snapshotPriceMap(snapshot);
    const memberUpdates: Array<Record<string, unknown>> = [];
    const dueHorizonUpdates: Array<Record<string, unknown>> = [];
    let dueOutcomeCount = 0;
    let unavailableOutcomeCount = 0;
    let updatedMemberCount = 0;

    for (const member of members) {
      const currentSnapshot = priceMap.get(member.ticker);
      const currentPrice = positiveNumber(currentSnapshot?.price);
      const sourceTimestampMs = currentSnapshot?.sourceTimestampMs ?? null;
      const sourceObservedAt =
        sourceTimestampMs !== null ? new Date(sourceTimestampMs).toISOString() : null;
      const memberHorizons = horizonsByMember.get(member.id) ?? [];
      const dueHorizons = memberHorizons.filter(
        (horizon) =>
          !horizon.complete && new Date(horizon.target_at).getTime() <= now.getTime(),
      );
      dueOutcomeCount += dueHorizons.length;

      if (
        currentPrice === null ||
        sourceTimestampMs === null ||
        sourceTimestampMs < new Date(member.latest_observed_at).getTime()
      ) {
        unavailableOutcomeCount += dueHorizons.length;
        continue;
      }

      updatedMemberCount += 1;
      const entryPrice = finiteNumber(member.entry_price);
      const previousHigh = finiteNumber(member.sampled_high_price, entryPrice);
      const previousLow = finiteNumber(member.sampled_low_price, entryPrice);
      const newHigh = Math.max(previousHigh, currentPrice);
      const newLow = Math.min(previousLow, currentPrice);
      const highChanged = newHigh > previousHigh;
      const lowChanged = newLow < previousLow;
      const maxGainPercent =
        computeProxReturnPercent(entryPrice, newHigh) ?? finiteNumber(member.max_gain_percent);
      const maxDrawdownPercent =
        computeProxReturnPercent(entryPrice, newLow) ??
        finiteNumber(member.max_drawdown_percent);
      const sampledHighAt = highChanged ? (sourceObservedAt as string) : member.sampled_high_at;
      const sampledLowAt = lowChanged ? (sourceObservedAt as string) : member.sampled_low_at;
      const timeToPeakMinutes = Math.max(
        0,
        (new Date(sampledHighAt).getTime() - new Date(member.decision_at).getTime()) / 60_000,
      );

      const returnByHorizon: Partial<Record<ProxOutcomeHorizon, number>> = {};
      for (const horizon of memberHorizons) {
        if (horizon.complete && horizon.return_percent !== null) {
          returnByHorizon[horizon.horizon] = finiteNumber(horizon.return_percent);
        }
      }
      for (const horizon of dueHorizons) {
        if (sourceTimestampMs < new Date(horizon.target_at).getTime() - 60_000) {
          unavailableOutcomeCount += 1;
          continue;
        }
        const returnPercent = computeProxReturnPercent(entryPrice, currentPrice);
        if (returnPercent === null) {
          unavailableOutcomeCount += 1;
          continue;
        }
        returnByHorizon[horizon.horizon] = returnPercent;
        dueHorizonUpdates.push({
          member_outcome_id: member.id,
          horizon: horizon.horizon,
          target_at: horizon.target_at,
          measured_at: sourceObservedAt,
          measured_price: currentPrice,
          return_percent: returnPercent,
          complete: true,
          updated_at: observedAt,
        });
      }

      const finalHorizonsComplete =
        returnByHorizon["24h"] !== undefined && returnByHorizon.next_session !== undefined;
      memberUpdates.push({
        id: member.id,
        latest_price: currentPrice,
        latest_observed_at: sourceObservedAt,
        sampled_high_price: newHigh,
        sampled_high_at: sampledHighAt,
        sampled_low_price: newLow,
        sampled_low_at: sampledLowAt,
        max_gain_percent: maxGainPercent,
        max_drawdown_percent: maxDrawdownPercent,
        time_to_peak_minutes: Number(timeToPeakMinutes.toFixed(1)),
        status: finalHorizonsComplete ? "complete" : "active",
        completed_at: finalHorizonsComplete ? observedAt : null,
        updated_at: observedAt,
      });
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
    const complete = dueOutcomeCount === persistedOutcomeCount + unavailableOutcomeCount;
    const completedAt = new Date().toISOString();
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
        diagnostics: {
          authority: "shadow_research_only",
          engineVersion: PROX_SHADOW_BOARD_OUTCOMES_VERSION,
          snapshotCount: snapshot.length,
          noPublicScore: true,
          noExecutionAuthority: true,
        },
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
        snapshotCount: snapshot.length,
        activeMemberCount: members.length,
        updatedMemberCount,
        dueOutcomeCount,
        persistedOutcomeCount,
        unavailableOutcomeCount,
      },
      timestamp: completedAt,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Pro X shadow-board outcomes failed.");
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
