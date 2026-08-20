// app/api/prox-shadow-board-scorecard/route.ts
//
// Read-only: aggregates completed prox_shadow_board_member_outcome_horizons
// by disposition x horizon (does ProX's own selected/blocked/rejected split
// actually separate winners from losers), alongside a parallel aggregate
// from ht_opportunity_ledger over the same window (is ProX competitive with
// canonical). Two summaries side by side, not a row-level ticker+timestamp
// join -- that tighter pairing is a reasonable follow-on once this proves
// useful. No writes, no effect on either system.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function rate(hits: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((hits / total) * 10000) / 100;
}

type HorizonRow = {
  member_outcome_id: string;
  horizon: string;
  return_percent: number;
};

type MemberOutcomeRow = {
  id: string;
  member_id: string;
  max_gain_percent: number;
  max_drawdown_percent: number;
  sampled_high_at: string;
  sampled_low_at: string;
};

type MemberRow = {
  id: string;
  disposition: "selected" | "blocked" | "rejected";
  role: "hero" | "contender" | "radar" | "none";
};

async function readInBatches<T>(
  ids: string[],
  reader: (batch: string[]) => Promise<T[]>,
  batchSize = 200,
) {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    rows.push(...(await reader(ids.slice(index, index + batchSize))));
  }
  return rows;
}

function buildProxScorecard(
  horizonRows: HorizonRow[],
  outcomeById: Map<string, MemberOutcomeRow>,
  memberById: Map<string, MemberRow>,
) {
  type Group = { returns: number[] };
  const byDispositionHorizon = new Map<string, Group>();
  const seenOutcomeIdsByDisposition = new Map<string, Set<string>>();

  for (const horizonRow of horizonRows) {
    const outcome = outcomeById.get(horizonRow.member_outcome_id);
    if (!outcome) continue;
    const member = memberById.get(outcome.member_id);
    if (!member) continue;
    const key = `${member.disposition}:${horizonRow.horizon}`;
    const group = byDispositionHorizon.get(key) ?? { returns: [] };
    group.returns.push(horizonRow.return_percent);
    byDispositionHorizon.set(key, group);

    const seen = seenOutcomeIdsByDisposition.get(member.disposition) ?? new Set<string>();
    seen.add(outcome.id);
    seenOutcomeIdsByDisposition.set(member.disposition, seen);
  }

  const byDispositionHorizonResult = [...byDispositionHorizon.entries()].map(
    ([key, group]) => {
      const [disposition, horizon] = key.split(":");
      return {
        disposition,
        horizon,
        sampleSize: group.returns.length,
        averageReturnPercent: average(group.returns),
      };
    },
  );

  const byDisposition = [...seenOutcomeIdsByDisposition.entries()].map(
    ([disposition, outcomeIds]) => {
      const outcomes = [...outcomeIds]
        .map((id) => outcomeById.get(id))
        .filter((outcome): outcome is MemberOutcomeRow => Boolean(outcome));
      const gains = outcomes.map((outcome) => finite(outcome.max_gain_percent) ?? 0);
      const drawdowns = outcomes.map(
        (outcome) => finite(outcome.max_drawdown_percent) ?? 0,
      );
      const plusFiveBeforeMinusFive = outcomes.filter((outcome) => {
        const gain = finite(outcome.max_gain_percent) ?? 0;
        const drawdown = finite(outcome.max_drawdown_percent) ?? 0;
        if (gain < 5) return false;
        if (drawdown > -5) return true;
        return new Date(outcome.sampled_high_at).getTime() <=
          new Date(outcome.sampled_low_at).getTime();
      }).length;
      return {
        disposition,
        sampleSize: outcomes.length,
        averageMaxGainPercent: average(gains),
        averageMaxDrawdownPercent: average(drawdowns),
        plusFiveBeforeMinusFiveHitRatePercent: rate(
          plusFiveBeforeMinusFive,
          outcomes.length,
        ),
      };
    },
  );

  return { byDisposition, byDispositionHorizon: byDispositionHorizonResult };
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const windowStart = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: horizonData, error: horizonError } = await supabase
      .from("prox_shadow_board_member_outcome_horizons")
      .select("member_outcome_id,horizon,return_percent")
      .eq("complete", true)
      .gte("target_at", windowStart)
      .limit(20_000);
    if (horizonError) throw horizonError;
    const horizonRows = (horizonData ?? []) as HorizonRow[];

    const outcomeIds = [...new Set(horizonRows.map((row) => row.member_outcome_id))];
    const outcomeRows = await readInBatches(outcomeIds, async (batch) => {
      const { data, error } = await supabase
        .from("prox_shadow_board_member_outcomes")
        .select("id,member_id,max_gain_percent,max_drawdown_percent,sampled_high_at,sampled_low_at")
        .in("id", batch);
      if (error) throw error;
      return (data ?? []) as MemberOutcomeRow[];
    });
    const outcomeById = new Map(outcomeRows.map((row) => [row.id, row]));

    const memberIds = [...new Set(outcomeRows.map((row) => row.member_id))];
    const memberRows = await readInBatches(memberIds, async (batch) => {
      const { data, error } = await supabase
        .from("prox_shadow_board_members")
        .select("id,disposition,role")
        .in("id", batch);
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    });
    const memberById = new Map(memberRows.map((row) => [row.id, row]));

    const prox = buildProxScorecard(horizonRows, outcomeById, memberById);

    const { data: ledgerData, error: ledgerError } = await supabase
      .from("ht_opportunity_ledger")
      .select(
        "first_role,max_gain_percent,max_drawdown_percent,highest_price_at,lowest_price_at",
      )
      .gte("first_seen_at", windowStart)
      .limit(20_000);
    if (ledgerError) throw ledgerError;
    const ledgerByRole = new Map<
      string,
      { gains: number[]; drawdowns: number[]; plusFiveBeforeMinusFive: number; total: number }
    >();
    for (const row of ledgerData ?? []) {
      const role = String(row.first_role ?? "unknown");
      const group =
        ledgerByRole.get(role) ??
        { gains: [], drawdowns: [], plusFiveBeforeMinusFive: 0, total: 0 };
      const gain = finite(row.max_gain_percent) ?? 0;
      const drawdown = finite(row.max_drawdown_percent) ?? 0;
      group.gains.push(gain);
      group.drawdowns.push(drawdown);
      group.total += 1;
      if (
        gain >= 5 &&
        (drawdown > -5 ||
          new Date(row.highest_price_at).getTime() <=
            new Date(row.lowest_price_at).getTime())
      ) {
        group.plusFiveBeforeMinusFive += 1;
      }
      ledgerByRole.set(role, group);
    }
    const canonical = [...ledgerByRole.entries()].map(([role, group]) => ({
      role,
      sampleSize: group.total,
      averageMaxGainPercent: average(group.gains),
      averageMaxDrawdownPercent: average(group.drawdowns),
      plusFiveBeforeMinusFiveHitRatePercent: rate(
        group.plusFiveBeforeMinusFive,
        group.total,
      ),
    }));

    return NextResponse.json({
      windowDays: WINDOW_DAYS,
      prox,
      canonical,
      note:
        "ProX shadow board has only been tracking outcomes since this endpoint shipped -- early reads will show a thin sample, especially for longer horizons (24h needs a full day to resolve). Not a verdict yet, the instrument that will eventually produce one.",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
