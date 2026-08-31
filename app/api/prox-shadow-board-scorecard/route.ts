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
import {
  average,
  buildProxEpisodeScorecard,
  median,
  type ProxEpisodeHorizon,
  type ProxEpisodeRepresentative,
} from "@/lib/prox/shadow-scorecard";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;

// Same CRON_SECRET bearer-token check used everywhere else in this
// codebase for internal-only routes — this was reachable with no auth.
const CRON_SECRET = process.env.CRON_SECRET;
function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  return req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

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

function rate(hits: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((hits / total) * 10000) / 100;
}

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

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const supabase = getSupabase();
    const windowStart = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: episodeData, error: episodeError } = await supabase
      .from("prox_shadow_board_episode_representatives")
      .select(
        "member_outcome_id,member_id,ticker,trading_date,market_session,decision_at,entry_price,max_gain_percent,max_drawdown_percent,sampled_high_at,sampled_low_at,disposition,role",
      )
      .gte("decision_at", windowStart)
      .order("decision_at", { ascending: true })
      .limit(20_000);
    if (episodeError) throw episodeError;
    const episodes = (episodeData ?? []) as ProxEpisodeRepresentative[];
    const episodeOutcomeIds = episodes.map(
      (episode) => episode.member_outcome_id,
    );
    const horizonRows = await readInBatches(
      episodeOutcomeIds,
      async (batch) => {
      const { data, error } = await supabase
        .from("prox_shadow_board_member_outcome_horizons")
        .select("member_outcome_id,horizon,return_percent,resolution_state")
        .in("member_outcome_id", batch)
        .eq("complete", true)
        .eq("resolution_state", "measured");
      if (error) throw error;
      return (data ?? []) as ProxEpisodeHorizon[];
      },
    );

    const prox = buildProxEpisodeScorecard(horizonRows, episodes);

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
      {
        gains: number[];
        drawdowns: number[];
        plusFiveBeforeMinusFive: number;
        plusTenBeforeMinusFive: number;
        total: number;
      }
    >();
    for (const row of ledgerData ?? []) {
      const role = String(row.first_role ?? "unknown");
      const group =
        ledgerByRole.get(role) ??
        {
          gains: [],
          drawdowns: [],
          plusFiveBeforeMinusFive: 0,
          plusTenBeforeMinusFive: 0,
          total: 0,
        };
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
      if (
        gain >= 10 &&
        (drawdown > -5 ||
          new Date(row.highest_price_at).getTime() <=
            new Date(row.lowest_price_at).getTime())
      ) {
        group.plusTenBeforeMinusFive += 1;
      }
      ledgerByRole.set(role, group);
    }
    const canonical = [...ledgerByRole.entries()].map(([role, group]) => ({
      role,
      sampleSize: group.total,
      averageMaxGainPercent: average(group.gains),
      medianMaxGainPercent: median(group.gains),
      averageMaxDrawdownPercent: average(group.drawdowns),
      medianMaxDrawdownPercent: median(group.drawdowns),
      plusFiveBeforeMinusFiveHitRatePercent: rate(
        group.plusFiveBeforeMinusFive,
        group.total,
      ),
      plusTenBeforeMinusFiveHitRatePercent: rate(
        group.plusTenBeforeMinusFive,
        group.total,
      ),
    }));

    return NextResponse.json({
      windowDays: WINDOW_DAYS,
      prox,
      canonical,
      comparisonMode: "unpaired_parallel_benchmark",
      note:
        "ProX uses first ticker/date/session/disposition episodes so repeated five-minute frames cannot inflate the sample. Canonical remains an unpaired parallel benchmark, not proof of head-to-head superiority; a same-ticker/same-timestamp comparison is still required before promotion.",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error, "Unknown error."),
        expectedMigration: "0025_prox_shadow_episode_scorecard.sql",
      },
      { status: 500 },
    );
  }
}
