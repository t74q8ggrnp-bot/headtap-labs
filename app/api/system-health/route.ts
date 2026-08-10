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
const ACTIVE_MAX_PROX_AGE_HOURS = 10 / 60;
const ACTIVE_MAX_LEDGER_AGE_HOURS = 12 / 60;

type HealthCheck = {
  name: string;
  ok: boolean;
  message: string;
  detail?: unknown;
};

function hoursSince(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return Infinity;
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

function isWeekend(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  return weekday === "Sat" || weekday === "Sun";
}

function easternDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function finiteAgeLimit(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
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
  const activeMarketSession = isActiveMarketSession();
  const closedWeekend = isWeekend();
  const maxSignalAgeHours = closedWeekend
    ? Infinity
    : activeMarketSession
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
          ? closedWeekend
            ? "Latest authoritative scan run is retained for the closed weekend."
            : "Latest authoritative scan run is fresh."
          : "Latest authoritative scan run is stale.",
      detail: promotedRun ? {
        runId: promotedRun.id,
        completedAt: promotedRun.completed_at,
        ageHours: Number.isFinite(runAge) ? Number(runAge.toFixed(2)) : null,
        engineVersion: promotedRun.engine_version,
      } : null,
    });

    const candidateCounts = (promotedRun?.candidate_counts ?? {}) as Record<
      string,
      unknown
    >;
    const sessionSchemaReady = candidateCounts.reclaimSchemaReady === true;
    const peakRetentionSchemaReady =
      candidateCounts.peakRetentionSchemaReady === true;
    const writerVersionMatch = String(
      promotedRun?.engine_version ?? "",
    ).match(/^signal-writer-v(\d+)-/);
    const writerIsSessionAware =
      Number(writerVersionMatch?.[1] ?? 0) >= 5;
    checks.push({
      name: "session_aware_writer",
      ok: Boolean(promotedRun) && writerIsSessionAware && sessionSchemaReady,
      message:
        writerIsSessionAware && sessionSchemaReady
          ? "Session-aware writer and database fields are active."
          : "The promoted run is not using the complete session-aware writer.",
      detail: promotedRun
        ? {
            engineVersion: promotedRun.engine_version,
            schemaReady: sessionSchemaReady,
            marketSession: candidateCounts.marketSession ?? null,
            reclaimCandidates: candidateCounts.retrievedForReclaim ?? null,
          }
        : null,
    });

    let runRowCount = 0;
    const expectedRunRowCount = Number(
      (promotedRun?.candidate_counts as { runRows?: unknown } | null)?.runRows ?? 0,
    );
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
      ok:
        runRowCount > 0 &&
        (!Number.isFinite(expectedRunRowCount) ||
          expectedRunRowCount <= 0 ||
          runRowCount === expectedRunRowCount),
      message:
        runRowCount <= 0
          ? "The latest authoritative run has no readable rows."
          : Number.isFinite(expectedRunRowCount) &&
              expectedRunRowCount > 0 &&
              runRowCount !== expectedRunRowCount
            ? "The promoted run row count does not match the writer's recorded total."
            : "Authoritative run rows are available to Home and Scanner.",
      detail: {
        count: runRowCount,
        expectedCount:
          Number.isFinite(expectedRunRowCount) && expectedRunRowCount > 0
            ? expectedRunRowCount
            : null,
      },
    });

    if (promotedRun?.id && sessionSchemaReady) {
      const { data: sessionRows, error: sessionRowsError } = await supabase
        .from("ht_signal_run_rows")
        .select(
          "ticker,price,session_open_price,change_from_open_percent,scan_session",
        )
        .eq("scan_run_id", promotedRun.id)
        .not("session_open_price", "is", null)
        .not("change_from_open_percent", "is", null)
        .limit(25);
      if (sessionRowsError) throw sessionRowsError;
      const validRows = (sessionRows ?? []).filter((row) => {
        const price = Number(row.price);
        const open = Number(row.session_open_price);
        const storedChange = Number(row.change_from_open_percent);
        const calculatedChange =
          price > 0 && open > 0 ? ((price - open) / open) * 100 : NaN;
        return (
          Number.isFinite(calculatedChange) &&
          Math.abs(calculatedChange - storedChange) <= 0.05 &&
          ["pre_market", "regular", "after_hours", "closed"].includes(
            String(row.scan_session),
          )
        );
      });
      checks.push({
        name: "session_data_integrity",
        ok: validRows.length > 0 && validRows.length === sessionRows?.length,
        message:
          validRows.length > 0 && validRows.length === sessionRows?.length
            ? "Stored session movement matches price and current-day open."
            : "Stored session movement failed its arithmetic or session-label check.",
        detail: {
          sampled: sessionRows?.length ?? 0,
          valid: validRows.length,
          tickers: validRows.slice(0, 5).map((row) => row.ticker),
        },
      });
    }

    if (promotedRun?.id && peakRetentionSchemaReady) {
      const { data: peakRows, error: peakRowsError } = await supabase
        .from("ht_signal_run_rows")
        .select(
          "ticker,price,session_high_price,pullback_from_session_high_percent",
        )
        .eq("scan_run_id", promotedRun.id)
        .not("session_high_price", "is", null)
        .not("pullback_from_session_high_percent", "is", null)
        .limit(25);
      if (peakRowsError) throw peakRowsError;
      const validPeakRows = (peakRows ?? []).filter((row) => {
        const price = Number(row.price);
        const high = Number(row.session_high_price);
        const storedPullback = Number(
          row.pullback_from_session_high_percent,
        );
        const calculatedPullback =
          price > 0 && high >= price
            ? Math.max(0, ((high - price) / high) * 100)
            : NaN;
        return (
          Number.isFinite(calculatedPullback) &&
          Math.abs(calculatedPullback - storedPullback) <= 0.05
        );
      });
      checks.push({
        name: "peak_retention_data_integrity",
        ok:
          validPeakRows.length > 0 &&
          validPeakRows.length === peakRows?.length,
        message:
          validPeakRows.length > 0 &&
          validPeakRows.length === peakRows?.length
            ? "Session-high context is present and arithmetically valid."
            : "Session-high context failed its arithmetic check.",
        detail: {
          sampled: peakRows?.length ?? 0,
          valid: validPeakRows.length,
          tickers: validPeakRows.slice(0, 5).map((row) => row.ticker),
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "promoted_run_pipeline",
      ok: false,
      message: "Could not verify the authoritative run-scoped pipeline.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }


  try {
    const expandedProxResult = await supabase
      .from("prox_market_features")
      .select(
        "ticker,computed_at,window_high_price,pullback_from_window_high_percent,minutes_since_window_high",
      )
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const legacyProxResult = expandedProxResult.error
      ? await supabase
          .from("prox_market_features")
          .select("ticker,computed_at")
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : null;
    const proxFeature = expandedProxResult.error
      ? legacyProxResult?.data
      : expandedProxResult.data;
    const proxError = expandedProxResult.error
      ? legacyProxResult?.error
      : null;
    if (proxError) throw proxError;
    const proxAge = hoursSince(proxFeature?.computed_at);
    const proxMaxAge = closedWeekend
      ? Infinity
      : activeMarketSession
        ? ACTIVE_MAX_PROX_AGE_HOURS
        : CLOSED_MAX_SIGNAL_AGE_HOURS;
    checks.push({
      name: "prox_market_pulse_freshness",
      ok: Boolean(proxFeature) && proxAge <= proxMaxAge,
      message:
        proxFeature && proxAge <= proxMaxAge
          ? closedWeekend
            ? "Latest ProX market pulse is retained for the closed weekend."
            : "ProX market pulse is fresh."
          : "ProX market pulse is missing or stale.",
      detail: proxFeature
        ? {
            ticker: proxFeature.ticker,
            computedAt: proxFeature.computed_at,
            ageMinutes: Number.isFinite(proxAge)
              ? Number((proxAge * 60).toFixed(1))
              : null,
            maxAgeMinutes: Number.isFinite(proxMaxAge)
              ? Number((proxMaxAge * 60).toFixed(1))
              : null,
            windowHighPrice:
              "window_high_price" in proxFeature
                ? proxFeature.window_high_price
                : null,
            pullbackFromWindowHighPercent:
              "pullback_from_window_high_percent" in proxFeature
                ? proxFeature.pullback_from_window_high_percent
                : null,
            minutesSinceWindowHigh:
              "minutes_since_window_high" in proxFeature
                ? proxFeature.minutes_since_window_high
                : null,
          }
        : null,
    });
  } catch (err: unknown) {
    checks.push({
      name: "prox_market_pulse_freshness",
      ok: false,
      message: "Could not verify ProX market pulse freshness.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  let latestSignal: {
    ticker?: string;
    scanned_at?: string;
    price?: number;
    change_percent?: number;
    relative_volume?: number;
    ht_score?: number;
  } | null = null;
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
  } catch (err: unknown) {
    checks.push({
      name: "ht_signals_read",
      ok: false,
      message: "Unexpected ht_signals read failure.",
      detail: err instanceof Error ? err.message : String(err),
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
        ? closedWeekend
          ? "Latest verified signal is retained for the closed weekend."
          : "Latest verified signal is within acceptable freshness window."
        : "Latest signal is too stale for homepage confidence.",
      detail: {
        ageHours: Number.isFinite(age) ? Number(age.toFixed(2)) : null,
        maxAgeHours: finiteAgeLimit(maxSignalAgeHours),
        scanned_at: latestSignal.scanned_at,
      },
    });

    const signalDataIsValid =
      Number.isFinite(price) &&
      price > 0 &&
      Number.isFinite(change) &&
      Number.isFinite(rvol) &&
      rvol >= 0 &&
      Number.isFinite(htScore) &&
      htScore > 0;

    checks.push({
      name: "signal_data_quality",
      ok: signalDataIsValid,
      message: signalDataIsValid
        ? "Latest compatibility signal has structurally valid market data."
        : "Latest compatibility signal contains invalid price/change/rvol/score data.",
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
    } catch (err: unknown) {
      checks.push({
        name: "displayable_signals",
        ok: false,
        message: "Could not verify displayable signals.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // This is the canonical record of what HT actually displayed and what price
  // did afterward. A missing migration or impossible MFE/MAE arithmetic must be
  // visible here instead of silently producing empty performance history.
  try {
    const tradingDate = easternDateString();
    const ledgerExpected = activeMarketSession && displayableCount > 0;
    const { data: ledger, error: ledgerError } = await supabase
      .from("ht_opportunity_ledger")
      .select(
        "ticker,trading_date,first_seen_at,first_seen_price,highest_price_after_signal,lowest_price_after_signal,max_gain_percent,max_drawdown_percent,updated_at",
      )
      .eq("trading_date", tradingDate)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ledgerError) throw ledgerError;

    if (!ledger) {
      checks.push({
        name: "opportunity_outcome_ledger",
        ok: !ledgerExpected,
        message: ledgerExpected
          ? "Opportunity ledger has displayable signals but no record for the active session."
          : "Opportunity ledger schema is ready and awaiting its next active-session record.",
        detail: {
          tradingDate,
          activeMarketSession,
          displayableSignals: displayableCount,
        },
      });
    } else {
      const entry = Number(ledger.first_seen_price);
      const high = Number(ledger.highest_price_after_signal);
      const low = Number(ledger.lowest_price_after_signal);
      const storedMfe = Number(ledger.max_gain_percent);
      const storedMae = Number(ledger.max_drawdown_percent);
      const calculatedMfe = entry > 0 ? ((high - entry) / entry) * 100 : NaN;
      const calculatedMae = entry > 0 ? ((low - entry) / entry) * 100 : NaN;
      const ledgerAgeHours = hoursSince(ledger.updated_at);
      const ledgerIsFresh =
        !ledgerExpected || ledgerAgeHours <= ACTIVE_MAX_LEDGER_AGE_HOURS;
      const validLedgerMath =
        entry > 0 &&
        high >= entry &&
        low <= entry &&
        Number.isFinite(storedMfe) &&
        Number.isFinite(storedMae) &&
        Math.abs(storedMfe - calculatedMfe) <= 0.05 &&
        Math.abs(storedMae - calculatedMae) <= 0.05;

      checks.push({
        name: "opportunity_outcome_ledger",
        ok: validLedgerMath && ledgerIsFresh,
        message: !validLedgerMath
          ? "Opportunity ledger contains invalid first-price or MFE/MAE arithmetic."
          : !ledgerIsFresh
            ? "Opportunity ledger is stale during the active market session."
            : "First-discovery price, write freshness, and post-discovery outcome math are valid.",
        detail: {
          ticker: ledger.ticker,
          tradingDate: ledger.trading_date,
          firstSeenAt: ledger.first_seen_at,
          firstSeenPrice: entry,
          highestPriceAfterSignal: high,
          lowestPriceAfterSignal: low,
          maxGainPercent: storedMfe,
          maxDrawdownPercent: storedMae,
          updatedAt: ledger.updated_at,
          ageMinutes: Number.isFinite(ledgerAgeHours)
            ? Number((ledgerAgeHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: ACTIVE_MAX_LEDGER_AGE_HOURS * 60,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "opportunity_outcome_ledger",
      ok: false,
      message: "Opportunity ledger is unavailable; run migration 0008 before deploying.",
      detail: err instanceof Error ? err.message : String(err),
    });
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
