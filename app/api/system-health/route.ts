// ─────────────────────────────────────────────────────────────
// app/api/system-health/route.ts
//
// HT LABS SYSTEM HEALTH
//
// Purpose:
// - Prove the signal pipeline is healthy.
// - No fake fallbacks.
// - No local/demo data.
// - Tells us exactly what is broken if the app cannot show verified signals.
//
// Checks:
// - Supabase env vars exist
// - Polygon key exists
// - ht_signals is readable
// - latest verified signal exists
// - latest signal is not too stale
// - latest signal has real price/change/rvol data
// - current opportunities API should be able to display data
// ─────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ACTIVE_MAX_SIGNAL_AGE_HOURS = 20 / 60;
const CLOSED_MAX_SIGNAL_AGE_HOURS = 8;

type HealthCheck = {
  name: string;
  ok: boolean;
  message: string;
  detail?: any;
};

function hoursSince(value: any) {
  if (!value) return Infinity;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return (Date.now() - timestamp) / (1000 * 60 * 60);
}

function isActiveMarketSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || weekday === "Sat" || weekday === "Sun") return false;
  const minutes = hour * 60 + minute;
  return minutes >= 240 && minutes < 1200;
}

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET() {
  const checks: HealthCheck[] = [];
  const maxSignalAgeHours = isActiveMarketSession()
    ? ACTIVE_MAX_SIGNAL_AGE_HOURS
    : CLOSED_MAX_SIGNAL_AGE_HOURS;

  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasSupabaseKey = Boolean(
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const hasPolygonKey = Boolean(process.env.POLYGON_API_KEY);

  checks.push({
    name: "supabase_env",
    ok: hasSupabaseUrl && hasSupabaseKey,
    message: hasSupabaseUrl && hasSupabaseKey
      ? "Supabase env vars available."
      : "Missing Supabase env vars.",
    detail: {
      hasUrl: hasSupabaseUrl,
      hasServerKey: Boolean(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    },
  });

  checks.push({
    name: "polygon_env",
    ok: hasPolygonKey,
    message: hasPolygonKey
      ? "Polygon API key available."
      : "Missing POLYGON_API_KEY.",
  });

  const supabase = getSupabase();

  if (!supabase) {
    const ok = false;

    return NextResponse.json({
      ok,
      status: "unhealthy",
      message: "System health failed before database check.",
      checks,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }

  // Home and Scanner read the latest promoted run-scoped dataset.
  try {
    const { data: promotedRun, error: promotedRunError } = await supabase
      .from("ht_scan_runs")
      .select("id,completed_at,engine_version,candidate_counts")
      .eq("run_type", "signal_writer_v3")
      .eq("status", "success")
      .eq("promoted", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (promotedRunError) throw promotedRunError;

    const runAge = hoursSince(promotedRun?.completed_at);
    checks.push({
      name: "promoted_run_freshness",
      ok: Boolean(promotedRun) && runAge <= maxSignalAgeHours,
      message: !promotedRun
        ? "No promoted authoritative scan run exists."
        : runAge <= maxSignalAgeHours
          ? "Latest authoritative scan run is fresh."
          : "Latest authoritative scan run is stale.",
      detail: promotedRun ? {
        runId: promotedRun.id,
        completedAt: promotedRun.completed_at,
        ageHours: Number.isFinite(runAge) ? Number(runAge.toFixed(2)) : null,
        engineVersion: promotedRun.engine_version,
      } : null,
    });

    let runRowCount = 0;
    if (promotedRun?.id) {
      const { count, error: countError } = await supabase
        .from("ht_signal_run_rows")
        .select("*", { count: "exact", head: true })
        .eq("scan_run_id", promotedRun.id);
      if (countError) throw countError;
      runRowCount = count ?? 0;
    }
    checks.push({
      name: "promoted_run_rows",
      ok: runRowCount > 0,
      message: runRowCount > 0
        ? "Authoritative run rows are available to Home and Scanner."
        : "The latest authoritative run has no readable rows.",
      detail: { count: runRowCount },
    });
  } catch (err: unknown) {
    checks.push({
      name: "promoted_run_pipeline",
      ok: false,
      message: "Could not verify the authoritative run-scoped pipeline.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  let latestSignal: any = null;
  let readable = false;

  try {
    const { data, error } = await supabase
      .from("ht_signals")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(1);

    if (error) {
      checks.push({
        name: "ht_signals_read",
        ok: false,
        message: "Cannot read ht_signals.",
        detail: error.message,
      });
    } else {
      readable = true;
      latestSignal = data?.[0] ?? null;

      checks.push({
        name: "ht_signals_read",
        ok: true,
        message: "ht_signals is readable.",
      });

      checks.push({
        name: "latest_signal_exists",
        ok: Boolean(latestSignal),
        message: latestSignal
          ? "Latest verified signal found."
          : "No verified signal rows found in ht_signals.",
        detail: latestSignal
          ? {
              ticker: latestSignal.ticker,
              scanned_at: latestSignal.scanned_at,
            }
          : null,
      });
    }
  } catch (err: any) {
    checks.push({
      name: "ht_signals_read",
      ok: false,
      message: "Unexpected ht_signals read failure.",
      detail: err?.message || String(err),
    });
  }

  if (latestSignal) {
    const age = hoursSince(latestSignal.scanned_at);
    const price = Number(latestSignal.price || 0);
    const change = Number(latestSignal.change_percent || 0);
    const rvol = Number(latestSignal.relative_volume || 0);
    const htScore = Number(latestSignal.ht_score || 0);

    checks.push({
      name: "signal_freshness",
      ok: age <= maxSignalAgeHours,
      message: age <= maxSignalAgeHours
        ? "Latest verified signal is within acceptable freshness window."
        : "Latest signal is too stale for homepage confidence.",
      detail: {
        ageHours: Number.isFinite(age) ? Number(age.toFixed(2)) : null,
        maxAgeHours: Number(maxSignalAgeHours.toFixed(2)),
        scanned_at: latestSignal.scanned_at,
      },
    });

    checks.push({
      name: "signal_data_quality",
      ok: price > 0 && change > 0 && rvol > 0 && htScore > 0,
      message: price > 0 && change > 0 && rvol > 0 && htScore > 0
        ? "Latest signal has real positive momentum data."
        : "Latest signal is missing required price/change/rvol/score data.",
      detail: {
        ticker: latestSignal.ticker,
        price,
        change_percent: change,
        relative_volume: rvol,
        ht_score: htScore,
      },
    });
  }

  // Same read logic opportunities depends on. This helps catch RLS/key problems.
  let displayableCount = 0;

  if (readable) {
    try {
      const { data, error } = await supabase
        .from("ht_signals")
        .select("ticker, price, change_percent, relative_volume, ht_score, scanned_at")
        .gt("price", 0)
        .gt("change_percent", 0)
        .gt("relative_volume", 0)
        .order("scanned_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      displayableCount = data?.length ?? 0;

      checks.push({
        name: "displayable_signals",
        ok: displayableCount > 0,
        message: displayableCount > 0
          ? "Displayable verified signals are available."
          : "No displayable positive momentum signals available.",
        detail: {
          count: displayableCount,
        },
      });
    } catch (err: any) {
      checks.push({
        name: "displayable_signals",
        ok: false,
        message: "Could not verify displayable signals.",
        detail: err?.message || String(err),
      });
    }
  }

  const hardFailures = checks.filter((check) => !check.ok);
  const ok = hardFailures.length === 0;

  return NextResponse.json({
    ok,
    status: ok ? "healthy" : "needs_attention",
    message: ok
      ? "HT Labs signal pipeline is healthy."
      : "HT Labs signal pipeline needs attention.",
    summary: {
      latestTicker: latestSignal?.ticker ?? null,
      latestSignalAt: latestSignal?.scanned_at ?? null,
      displayableSignals: displayableCount,
      failures: hardFailures.map((check) => check.name),
    },
    checks,
    timestamp: new Date().toISOString(),
  }, { status: ok ? 200 : 500 });
}
