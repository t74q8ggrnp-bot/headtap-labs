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
import { getErrorMessage } from "@/lib/error-message";
import { auditCanonicalSpotMomentumFeed } from "@/lib/canonical-feed-integrity";
import { getRollingCanonicalDecisionFrame } from "@/lib/canonical-decision-frame";
import { getDecisionFrameMarketTimingFreshness } from "@/lib/canonical-decision-frame-policy";
import { auditTopMoverDispositions } from "@/lib/top-mover-disposition";
import {
  PROX_PUBLIC_AUTHORITY_CONTRACT,
  PROX_PUBLIC_AUTHORITY_VERSION,
} from "@/lib/prox/public-authority";
import { PROX_MARKET_DISCOVERY_VERSION } from "@/lib/prox/market-discovery";
import { PROX_SECURITY_ROUTING_VERSION } from "@/lib/prox/security-routing";
import {
  PROX_OUTCOME_MEMORY_VERSION,
  PROX_SHADOW_BOARD_OUTCOMES_VERSION,
} from "@/lib/prox/outcome-memory";
import { PROX_MARKET_STRUCTURE_VERSION } from "@/lib/prox/market-structure";
import {
  PROX_EDGE_SCORE_VERSION,
  assertNoForbiddenProxInputs,
} from "@/lib/prox/edge-score";
import { PROX_SHADOW_BOARD_VERSION } from "@/lib/prox/shadow-board";
import { PROX_OUTCOME_UNAVAILABLE_AFTER_MS } from "@/lib/prox/shadow-outcome-resolution";
import { isActiveMarketTimestampUsable } from "@/lib/market-data-time";
import { probeMassiveRealtimeEntitlement } from "@/lib/massive-stocks";
import {
  PROX_MICROSTRUCTURE_AUTHORITY,
  PROX_MICROSTRUCTURE_VERSION,
} from "@/lib/prox/microstructure";
import { PAPER_TRADING_CONTRACT_VERSION } from "@/lib/paper-trading/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTIVE_MAX_SIGNAL_AGE_HOURS = 6 / 60;
const CLOSED_MAX_SIGNAL_AGE_HOURS = 8;
const ACTIVE_MAX_PROX_AGE_HOURS = 3 / 60;
const ACTIVE_MAX_MICROSTRUCTURE_AGE_HOURS = 3 / 60;
const ACTIVE_MAX_DIRECT_DISCOVERY_AGE_HOURS = 6 / 60;
const ACTIVE_MAX_OUTCOME_MEMORY_AGE_HOURS = 8 / 60;
const ACTIVE_MAX_SHADOW_BOARD_AGE_HOURS = 6 / 60;
// Massive Advanced removes the former fifteen-minute market-data delay.
// Outcome collection still gets a short scheduling grace because Vercel cron
// and database writes are not an exchange streaming service.
const ACTIVE_MAX_SHADOW_BOARD_OUTCOMES_AGE_HOURS = 12 / 60;
const SHADOW_BOARD_OUTCOME_GRACE_MINUTES = 12;
const ACTIVE_MAX_TRANSITION_MEMORY_AGE_HOURS = 12 / 60;
const ACTIVE_MAX_TRANSITION_CALIBRATION_AGE_HOURS = 22 / 60;
const ACTIVE_MAX_LEDGER_AGE_HOURS = 12 / 60;
const MAX_CRYPTO_PROX_AGE_HOURS = 15 / 60;
const CRYPTO_OUTCOME_GRACE_MINUTES = 10;
const MAX_PAPER_MATCH_AGE_HOURS = 6 / 60;

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

type ProxRoutedObservationHealthRow = {
  id: string;
  security_type: string | null;
  instrument_lane: string | null;
  opportunity_eligible: boolean | null;
  metadata_state: string | null;
};

const PROX_OBSERVATION_HEALTH_PAGE_SIZE = 1_000;

async function loadProxRoutedObservationHealthRows(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  runId: string,
) {
  const rows: ProxRoutedObservationHealthRow[] = [];

  for (
    let offset = 0;
    ;
    offset += PROX_OBSERVATION_HEALTH_PAGE_SIZE
  ) {
    const { data, error } = await supabase
      .from("prox_market_discovery_observations")
      .select(
        "id,security_type,instrument_lane,opportunity_eligible,metadata_state",
      )
      .eq("run_id", runId)
      .order("id", { ascending: true })
      .range(offset, offset + PROX_OBSERVATION_HEALTH_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as ProxRoutedObservationHealthRow[];
    rows.push(...page);
    if (page.length < PROX_OBSERVATION_HEALTH_PAGE_SIZE) break;
  }

  return rows;
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

  if (hasPolygonKey) {
    const entitlement = await probeMassiveRealtimeEntitlement({ force: true });
    checks.push({
      name: "massive_realtime_entitlement",
      ok: entitlement.dataMode === "real_time",
      message: entitlement.dataMode === "real_time"
        ? "Massive real-time snapshots, last trades, and NBBO quotes are active."
        : "The configured Massive key is not proving real-time stock entitlement.",
      detail: {
        dataMode: entitlement.dataMode,
        snapshot: entitlement.snapshot,
        lastTrade: entitlement.lastTrade,
        lastQuote: entitlement.lastQuote,
        checkedAt: entitlement.checkedAt,
        errors: entitlement.errors,
      },
    });
  }

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

    const writerVersion = Number(writerVersionMatch?.[1] ?? 0);
    const dispositionAudit = auditTopMoverDispositions(
      candidateCounts.topMoverDispositions,
    );
    const dispositionReceiptsExpected = writerVersion >= 10;
    checks.push({
      name: "polygon_top_mover_dispositions",
      ok: !dispositionReceiptsExpected || dispositionAudit.complete,
      message: !dispositionReceiptsExpected
        ? "Top-mover disposition receipts activate with the next v10 promoted scan."
        : dispositionAudit.complete
          ? "Every sampled Polygon top mover has an explicit canonical or exclusion outcome."
          : "One or more sampled Polygon top movers disappeared without a complete disposition.",
      detail: {
        writerVersion,
        expected: dispositionReceiptsExpected,
        ...dispositionAudit,
      },
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
        "ticker,market_as_of,computed_at,window_high_price,pullback_from_window_high_percent,minutes_since_window_high",
      )
      // The sensor intentionally observes liquid and illiquid symbols. During
      // extended hours an illiquid symbol can be processed most recently while
      // its last real bar is hours old. Prove sensor vitality from the freshest
      // provider-time pulse, then use computed_at only as the tie-breaker.
      .order("market_as_of", { ascending: false, nullsFirst: false })
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
    const marketTimestampSchemaReady = !expandedProxResult.error;
    const proxProcessingAge = hoursSince(proxFeature?.computed_at);
    const proxMarketAge = hoursSince(
      proxFeature && "market_as_of" in proxFeature
        ? proxFeature.market_as_of
        : null,
    );
    const proxMaxAge = closedWeekend
      ? Infinity
      : activeMarketSession
        ? ACTIVE_MAX_PROX_AGE_HOURS
        : CLOSED_MAX_SIGNAL_AGE_HOURS;
    checks.push({
      name: "prox_market_pulse_freshness",
      ok:
        Boolean(proxFeature) &&
        marketTimestampSchemaReady &&
        proxProcessingAge <= proxMaxAge &&
        (closedWeekend ||
          !activeMarketSession ||
          isActiveMarketTimestampUsable(
            proxFeature && "market_as_of" in proxFeature
              ? proxFeature.market_as_of
              : null,
          )),
      message:
        !marketTimestampSchemaReady
          ? "ProX market source timestamps are unavailable; run migration 0026."
        : proxFeature &&
            proxProcessingAge <= proxMaxAge &&
            (closedWeekend ||
              !activeMarketSession ||
              isActiveMarketTimestampUsable(
                "market_as_of" in proxFeature
                  ? proxFeature.market_as_of
                  : null,
              ))
          ? closedWeekend
            ? "Latest ProX market pulse is retained for the closed weekend."
            : "ProX market pulse is fresh."
          : "ProX market pulse is missing or stale.",
      detail: proxFeature
        ? {
            ticker: proxFeature.ticker,
            marketAsOf:
              "market_as_of" in proxFeature
                ? proxFeature.market_as_of
                : null,
            computedAt: proxFeature.computed_at,
            sourceAgeMinutes: Number.isFinite(proxMarketAge)
              ? Number((proxMarketAge * 60).toFixed(1))
              : null,
            processingAgeMinutes: Number.isFinite(proxProcessingAge)
              ? Number((proxProcessingAge * 60).toFixed(1))
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
            marketTimestampSchemaReady,
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

  // Massive Advanced NBBO and consolidated prints are captured in a
  // separate append-only ProX evidence lane. This proves direct provider
  // coverage and timestamps without turning the evidence into a score.
  try {
    const { data: microstructureRun, error: microstructureRunError } =
      await supabase
        .from("prox_realtime_microstructure_runs")
        .select(
          "id,started_at,completed_at,status,market_session,source_data_mode,candidate_count,expected_observation_count,persisted_observation_count,quote_observation_count,trade_observation_count,provider_error_count,truncated_tape_count,latest_market_as_of,complete,engine_version,authority,diagnostics",
        )
        .eq("engine_version", PROX_MICROSTRUCTURE_VERSION)
        .eq("status", "success")
        .eq("complete", true)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (microstructureRunError) throw microstructureRunError;

    if (!microstructureRun) {
      checks.push({
        name: "prox_realtime_microstructure_observations",
        ok: !activeMarketSession,
        message: activeMarketSession
          ? "ProX has no completed real-time quote/tape observation cycle."
          : "ProX real-time microstructure schema is ready and awaiting the next active session.",
        detail: {
          activeMarketSession,
          engineVersion: PROX_MICROSTRUCTURE_VERSION,
          authority: PROX_MICROSTRUCTURE_AUTHORITY,
        },
      });
    } else {
      const { data: microstructureObservations, error: observationReadError } =
        await supabase
          .from("prox_realtime_microstructure_observations")
          .select("ticker,market_as_of,quote_as_of,trade_as_of")
          .eq("run_id", microstructureRun.id);
      if (observationReadError) throw observationReadError;

      const expectedCount = Number(
        microstructureRun.expected_observation_count,
      );
      const persistedCount = Number(
        microstructureRun.persisted_observation_count,
      );
      const quoteCount = Number(microstructureRun.quote_observation_count);
      const providerErrorCount = Number(
        microstructureRun.provider_error_count,
      );
      const ageHours = hoursSince(
        microstructureRun.completed_at ?? microstructureRun.started_at,
      );
      const quoteCoverage =
        expectedCount > 0 ? quoteCount / expectedCount : 0;
      const freshSourceRows = (microstructureObservations ?? []).filter(
        (row) =>
          !activeMarketSession ||
          isActiveMarketTimestampUsable(row.market_as_of),
      );
      const sourceFreshCoverage =
        expectedCount > 0 ? freshSourceRows.length / expectedCount : 0;
      const exactCoverage =
        expectedCount > 0 &&
        expectedCount === persistedCount &&
        persistedCount === (microstructureObservations?.length ?? 0);
      const sourceFresh =
        !activeMarketSession ||
        sourceFreshCoverage >= 0.8;
      const processingFresh =
        !activeMarketSession ||
        ageHours <= ACTIVE_MAX_MICROSTRUCTURE_AGE_HOURS;
      const healthy =
        microstructureRun.complete === true &&
        microstructureRun.authority === PROX_MICROSTRUCTURE_AUTHORITY &&
        microstructureRun.source_data_mode === "real_time" &&
        exactCoverage &&
        providerErrorCount === 0 &&
        quoteCoverage >= 0.8 &&
        sourceFresh &&
        processingFresh;

      checks.push({
        name: "prox_realtime_microstructure_observations",
        ok: healthy,
        message:
          microstructureRun.authority !== PROX_MICROSTRUCTURE_AUTHORITY
            ? "ProX quote/tape evidence escaped its shadow-only authority contract."
            : microstructureRun.source_data_mode !== "real_time"
              ? "ProX quote/tape observations are not using Massive real-time data."
              : !exactCoverage
                ? "ProX quote/tape receipt does not exactly match persisted observations."
                : providerErrorCount > 0
                  ? "One or more direct quote/tape provider reads failed."
                  : quoteCoverage < 0.8
                    ? "Direct NBBO coverage fell below 80% of the research set."
                    : !sourceFresh
                      ? "ProX quote/tape provider timestamps are stale."
                      : !processingFresh
                        ? "ProX quote/tape collection is stale."
                        : activeMarketSession
                          ? "ProX is preserving fresh Massive NBBO and trade-tape evidence without changing scores."
                          : "Latest ProX quote/tape evidence is retained outside the active session.",
        detail: {
          runId: microstructureRun.id,
          engineVersion: microstructureRun.engine_version,
          authority: microstructureRun.authority,
          sourceDataMode: microstructureRun.source_data_mode,
          marketSession: microstructureRun.market_session,
          expectedCount,
          persistedCount,
          actualCount: microstructureObservations?.length ?? 0,
          quoteObservationCount: quoteCount,
          tradeObservationCount: Number(
            microstructureRun.trade_observation_count,
          ),
          quoteCoveragePercent: Number((quoteCoverage * 100).toFixed(1)),
          freshSourceCoveragePercent: Number(
            (sourceFreshCoverage * 100).toFixed(1),
          ),
          staleSourceTickers: (microstructureObservations ?? [])
            .filter(
              (row) =>
                activeMarketSession &&
                !isActiveMarketTimestampUsable(row.market_as_of),
            )
            .slice(0, 10)
            .map((row) => row.ticker),
          providerErrorCount,
          truncatedTapeCount: Number(
            microstructureRun.truncated_tape_count,
          ),
          latestMarketAsOf: microstructureRun.latest_market_as_of,
          completedAt: microstructureRun.completed_at,
          processingAgeMinutes: Number.isFinite(ageHours)
            ? Number((ageHours * 60).toFixed(1))
            : null,
          scoringChanged: false,
          executionAuthority: "none",
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "prox_realtime_microstructure_observations",
      ok: false,
      message:
        "ProX quote/tape evidence is unavailable; run migration 0027 before deploying.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Pro X now has an independent full-market Polygon observer. It remains
  // shadow/research-only, but its receipt must prove both freshness and exact
  // persistence coverage while the stock market data session is active.
  try {
    const { data: discoveryRun, error: discoveryRunError } = await supabase
      .from("prox_market_discovery_runs")
      .select(
        "id,started_at,completed_at,status,market_session,snapshot_count,eligible_count,expected_observation_count,persisted_observation_count,research_queued_count,complete,engine_version,diagnostics",
      )
      .eq("engine_version", PROX_MARKET_DISCOVERY_VERSION)
      .eq("status", "success")
      .eq("complete", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (discoveryRunError) throw discoveryRunError;

    if (!discoveryRun) {
      checks.push({
        name: "prox_direct_market_discovery",
        ok: !activeMarketSession,
        message: activeMarketSession
          ? "Pro X direct market discovery has no completed active-session run."
          : "Pro X direct market discovery schema is ready and awaiting its next active session.",
        detail: { activeMarketSession },
      });
      checks.push({
        name: "prox_security_type_routing",
        ok: !activeMarketSession,
        message: activeMarketSession
          ? "Pro X security routing has no completed v2 active-session run."
          : "Pro X security routing schema is ready and awaiting its next active session.",
        detail: {
          activeMarketSession,
          expectedEngineVersion: PROX_MARKET_DISCOVERY_VERSION,
          expectedRoutingVersion: PROX_SECURITY_ROUTING_VERSION,
        },
      });
    } else {
      const routedObservationRows =
        await loadProxRoutedObservationHealthRows(
          supabase,
          String(discoveryRun.id),
        );

      const ageHours = hoursSince(
        discoveryRun.completed_at ?? discoveryRun.started_at,
      );
      const expectedCount = Number(
        discoveryRun.expected_observation_count,
      );
      const persistedCount = Number(
        discoveryRun.persisted_observation_count,
      );
      const actualCount = routedObservationRows.length;
      const coverageComplete =
        discoveryRun.status === "success" &&
        discoveryRun.complete === true &&
        Number(discoveryRun.snapshot_count) > 0 &&
        expectedCount === persistedCount &&
        persistedCount === actualCount;
      const fresh =
        !activeMarketSession ||
        ageHours <= ACTIVE_MAX_DIRECT_DISCOVERY_AGE_HOURS;

      checks.push({
        name: "prox_direct_market_discovery",
        ok: coverageComplete && fresh,
        message: !coverageComplete
          ? "Pro X direct Polygon discovery failed its coverage receipt."
          : !fresh
            ? "Pro X direct Polygon discovery is stale during the active market-data session."
            : activeMarketSession
              ? "Pro X direct Polygon discovery is fresh and independently persisted."
              : "Latest Pro X direct Polygon discovery is retained outside the active session.",
        detail: {
          runId: discoveryRun.id,
          engineVersion: discoveryRun.engine_version,
          marketSession: discoveryRun.market_session,
          snapshotCount: Number(discoveryRun.snapshot_count),
          eligibleCount: Number(discoveryRun.eligible_count),
          expectedCount,
          persistedCount,
          actualCount,
          researchQueuedCount: Number(discoveryRun.research_queued_count),
          completedAt: discoveryRun.completed_at,
          ageMinutes: Number.isFinite(ageHours)
            ? Number((ageHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: activeMarketSession
            ? ACTIVE_MAX_DIRECT_DISCOVERY_AGE_HOURS * 60
            : null,
          mode:
            discoveryRun.diagnostics &&
            typeof discoveryRun.diagnostics === "object" &&
            "mode" in discoveryRun.diagnostics
              ? discoveryRun.diagnostics.mode
              : null,
        },
      });

      const rows = routedObservationRows;
      const invalidRows = rows.filter((row) => {
        const lane = String(row.instrument_lane ?? "");
        const securityType = String(row.security_type ?? "");
        const metadataState = String(row.metadata_state ?? "");
        const opportunityEligible = row.opportunity_eligible === true;
        if (lane === "excluded_asset") return true;
        if (lane === "opportunity_equity") {
          return (
            !opportunityEligible ||
            !["CS", "ADRC"].includes(securityType) ||
            metadataState !== "verified"
          );
        }
        if (opportunityEligible) return true;
        if (lane === "pending_verification") {
          return metadataState !== "pending";
        }
        return (
          !["market_context", "linked_instrument_context"].includes(lane) ||
          metadataState !== "verified"
        );
      });
      const discoveryDiagnostics =
        discoveryRun.diagnostics &&
        typeof discoveryRun.diagnostics === "object" &&
        !Array.isArray(discoveryRun.diagnostics)
          ? (discoveryRun.diagnostics as Record<string, unknown>)
          : {};
      const registryDiagnostics =
        discoveryDiagnostics.securityTypeRegistry &&
        typeof discoveryDiagnostics.securityTypeRegistry === "object" &&
        !Array.isArray(discoveryDiagnostics.securityTypeRegistry)
          ? (discoveryDiagnostics.securityTypeRegistry as Record<string, unknown>)
          : {};
      const routingVersionValid =
        discoveryDiagnostics.securityRoutingVersion ===
        PROX_SECURITY_ROUTING_VERSION;
      const registryAvailable =
        registryDiagnostics.source === "cache" ||
        registryDiagnostics.source === "provider";
      const routeIntegrityValid =
        rows.length === actualCount &&
        invalidRows.length === 0 &&
        routingVersionValid &&
        registryAvailable;
      checks.push({
        name: "prox_security_type_routing",
        ok: routeIntegrityValid,
        message: !routingVersionValid
          ? "Pro X security routing version is missing or stale."
          : !registryAvailable
            ? "The provider security-type registry is unavailable."
            : invalidRows.length > 0
              ? "Pro X security lanes contain an invalid opportunity-eligibility combination."
              : "Pro X security lanes are verified and only CS/ADRC observations can seed opportunity learning.",
        detail: {
          runId: discoveryRun.id,
          engineVersion: discoveryRun.engine_version,
          securityRoutingVersion:
            discoveryDiagnostics.securityRoutingVersion ?? null,
          registry: registryDiagnostics,
          routedObservationCount: rows.length,
          invalidRowCount: invalidRows.length,
          laneCounts: discoveryDiagnostics.laneCounts ?? null,
          selectedLaneCounts:
            discoveryDiagnostics.selectedLaneCounts ?? null,
          metadata: discoveryDiagnostics.securityMetadata ?? null,
        },
      });
    }
  } catch (err: unknown) {
    const message = getErrorMessage(
      err,
      "Unknown Pro X direct-discovery health-check error.",
    );
    checks.push({
      name: "prox_direct_market_discovery",
      ok: false,
      message: "Pro X direct Polygon discovery health validation failed.",
      detail: message,
    });
    checks.push({
      name: "prox_security_type_routing",
      ok: false,
      message: "Pro X security routing health validation failed.",
      detail: message,
    });
  }

  // The independent ProX board must be atomic, complete, and free of
  // canonical scoring inputs. It remains shadow-only and never changes the
  // public HT board or any execution path.
  try {
    const { data: boardRun, error: boardRunError } = await supabase
      .from("prox_shadow_board_runs")
      .select(
        "id,decision_at,completed_at,status,complete,candidate_count,expected_member_count,persisted_member_count,selected_count,blocked_count,rejected_count,hero_ticker,engine_version,structure_version,edge_score_version,security_routing_version,authority,diagnostics",
      )
      .eq("engine_version", PROX_SHADOW_BOARD_VERSION)
      .eq("status", "success")
      .eq("complete", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (boardRunError) throw boardRunError;

    if (!boardRun) {
      checks.push({
        name: "prox_independent_shadow_board",
        ok: !activeMarketSession,
        message: activeMarketSession
          ? "The independent ProX shadow board has no completed active-session frame."
          : "The independent ProX shadow board is awaiting its next active session.",
        detail: {
          activeMarketSession,
          expectedEngineVersion: PROX_SHADOW_BOARD_VERSION,
          expectedStructureVersion: PROX_MARKET_STRUCTURE_VERSION,
          expectedEdgeScoreVersion: PROX_EDGE_SCORE_VERSION,
        },
      });
    } else {
      const { data: members, count, error: membersError } = await supabase
        .from("prox_shadow_board_members")
        .select(
          "decision_at,ticker,market_session,discovery_pattern,edge_score,continuation_probability,reward_risk_asymmetry,evidence_confidence,risk_penalty,entry_qualified,role,disposition,rank,edge_assessment,structure_assessment,input_provenance",
          { count: "exact" },
        )
        .eq("run_id", boardRun.id)
        .order("edge_score", { ascending: false });
      if (membersError) throw membersError;
      const rows = members ?? [];
      const actualCount = count ?? 0;
      const expectedCount = Number(boardRun.expected_member_count);
      const persistedCount = Number(boardRun.persisted_member_count);
      const selected = rows.filter(
        (member) => member.disposition === "selected",
      );
      const blocked = rows.filter(
        (member) => member.disposition === "blocked",
      );
      const rejected = rows.filter(
        (member) => member.disposition === "rejected",
      );
      const hero = rows.filter((member) => member.role === "hero");
      const contenders = rows.filter(
        (member) => member.role === "contender",
      );
      const selectedRanks = selected
        .map((member) => Number(member.rank))
        .sort((left, right) => left - right);
      const expectedRanks = Array.from(
        { length: selected.length },
        (_, index) => index + 1,
      );
      const dispositionValid = rows.every((member) => {
        if (
          !["pre_market", "regular", "after_hours", "closed"].includes(
            String(member.market_session),
          ) ||
          String(member.discovery_pattern ?? "").trim().length === 0
        ) {
          return false;
        }
        if (member.disposition === "selected") {
          return (
            member.entry_qualified === true &&
            ["hero", "contender"].includes(String(member.role)) &&
            Number(member.rank) >= 1 &&
            Number(member.rank) <= 6
          );
        }
        if (member.disposition === "blocked") {
          return (
            member.entry_qualified === false &&
            member.role === "radar" &&
            member.rank === null
          );
        }
        return (
          member.disposition === "rejected" &&
          member.entry_qualified === true &&
          member.role === "none" &&
          member.rank === null
        );
      });
      const scoreMathValid = rows.every((member) => {
        const expected = Math.min(
          100,
          Math.max(
            0,
            Number(member.continuation_probability) * 0.6 +
              Number(member.reward_risk_asymmetry) * 0.3 +
              Number(member.evidence_confidence) * 0.1 -
              Number(member.risk_penalty),
          ),
        );
        return Math.abs(expected - Number(member.edge_score)) <= 0.2;
      });
      let forbiddenInputCount = 0;
      for (const member of rows) {
        try {
          assertNoForbiddenProxInputs(member.input_provenance);
          assertNoForbiddenProxInputs(member.edge_assessment);
          assertNoForbiddenProxInputs(member.structure_assessment);
        } catch {
          forbiddenInputCount += 1;
        }
      }
      const diagnostics =
        boardRun.diagnostics &&
        typeof boardRun.diagnostics === "object" &&
        !Array.isArray(boardRun.diagnostics)
          ? (boardRun.diagnostics as Record<string, unknown>)
          : {};
      const canonicalInputsConsumed = Array.isArray(
        diagnostics.canonicalInputsConsumed,
      )
        ? diagnostics.canonicalInputsConsumed
        : null;
      const coverageValid =
        Number(boardRun.candidate_count) === expectedCount &&
        expectedCount === persistedCount &&
        persistedCount === actualCount &&
        rows.length === actualCount &&
        Number(boardRun.selected_count) === selected.length &&
        Number(boardRun.blocked_count) === blocked.length &&
        Number(boardRun.rejected_count) === rejected.length;
      const boardShapeValid =
        dispositionValid &&
        selected.length <= 6 &&
        contenders.length <= 5 &&
        hero.length === (selected.length > 0 ? 1 : 0) &&
        JSON.stringify(selectedRanks) === JSON.stringify(expectedRanks) &&
        (hero[0]?.ticker ?? null) === boardRun.hero_ticker;
      const versionValid =
        boardRun.structure_version === PROX_MARKET_STRUCTURE_VERSION &&
        boardRun.edge_score_version === PROX_EDGE_SCORE_VERSION &&
        boardRun.security_routing_version ===
          PROX_SECURITY_ROUTING_VERSION &&
        boardRun.authority === "shadow_research_only";
      const independentInputValid =
        forbiddenInputCount === 0 &&
        canonicalInputsConsumed !== null &&
        canonicalInputsConsumed.length === 0;
      const frameAtomic = rows.every(
        (member) => member.decision_at === boardRun.decision_at,
      );
      const ageHours = hoursSince(
        boardRun.completed_at ?? boardRun.decision_at,
      );
      const fresh =
        !activeMarketSession ||
        ageHours <= ACTIVE_MAX_SHADOW_BOARD_AGE_HOURS;
      const ok =
        coverageValid &&
        boardShapeValid &&
        versionValid &&
        independentInputValid &&
        frameAtomic &&
        scoreMathValid &&
        fresh;
      checks.push({
        name: "prox_independent_shadow_board",
        ok,
        message: !coverageValid
          ? "The independent ProX board failed its complete-candidate disposition receipt."
          : !independentInputValid
            ? "A forbidden canonical decision field entered the independent ProX board."
            : !frameAtomic
              ? "ProX score, rank, price, and disposition do not share one atomic frame."
              : !scoreMathValid
                ? "A persisted ProX Edge Score does not match the versioned 60/30/10 contract."
                : !boardShapeValid || !versionValid
                  ? "The ProX board role, version, or shadow-authority contract is invalid."
                  : !fresh
                    ? "The independent ProX board is stale during the active market-data session."
                    : "The independent ProX board is fresh, atomic, complete, and free of canonical scoring inputs.",
        detail: {
          runId: boardRun.id,
          engineVersion: boardRun.engine_version,
          structureVersion: boardRun.structure_version,
          edgeScoreVersion: boardRun.edge_score_version,
          securityRoutingVersion: boardRun.security_routing_version,
          decisionAt: boardRun.decision_at,
          completedAt: boardRun.completed_at,
          ageMinutes: Number.isFinite(ageHours)
            ? Number((ageHours * 60).toFixed(1))
            : null,
          candidateCount: Number(boardRun.candidate_count),
          expectedCount,
          persistedCount,
          actualCount,
          selectedCount: selected.length,
          blockedCount: blocked.length,
          rejectedCount: rejected.length,
          heroTicker: boardRun.hero_ticker,
          forbiddenInputCount,
          canonicalInputsConsumed,
          frameAtomic,
          scoreMathValid,
          authority: boardRun.authority,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "prox_independent_shadow_board",
      ok: false,
      message:
        "The independent ProX shadow board is unavailable; run migration 0018 before deploying.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Shadow-board outcome tracking must account for every active decision
  // (selected, blocked, and rejected -- complete denominator) and every due
  // horizon, with no writes back to the shadow board itself.
  try {
    const { data: outcomeRun, error: outcomeRunError } = await supabase
      .from("prox_shadow_board_outcome_runs")
      .select(
        "id,observed_at,completed_at,status,complete,active_member_count,updated_member_count,due_outcome_count,persisted_outcome_count,unavailable_outcome_count,engine_version,diagnostics",
      )
      .eq("engine_version", PROX_SHADOW_BOARD_OUTCOMES_VERSION)
      .eq("status", "success")
      .eq("complete", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (outcomeRunError) throw outcomeRunError;

    if (!outcomeRun) {
      checks.push({
        name: "prox_shadow_board_outcomes",
        ok: !activeMarketSession,
        message: activeMarketSession
          ? "Shadow-board outcome tracking has no completed active-session run."
          : "Shadow-board outcome tracking is awaiting its next active session.",
        detail: {
          activeMarketSession,
          expectedEngineVersion: PROX_SHADOW_BOARD_OUTCOMES_VERSION,
        },
      });
    } else {
      const retryPendingCutoff = new Date(
        Date.now() - SHADOW_BOARD_OUTCOME_GRACE_MINUTES * 60_000,
      ).toISOString();
      const terminalOverdueCutoff = new Date(
        Date.now() - PROX_OUTCOME_UNAVAILABLE_AFTER_MS,
      ).toISOString();
      const { count: retryPendingOutcomeCount, error: retryPendingError } =
        await supabase
          .from("prox_shadow_board_member_outcome_horizons")
          .select("*", { count: "exact", head: true })
          .eq("complete", false)
          .lte("target_at", retryPendingCutoff);
      if (retryPendingError) throw retryPendingError;
      const { count: terminalOverdueOutcomeCount, error: terminalOverdueError } =
        await supabase
          .from("prox_shadow_board_member_outcome_horizons")
          .select("*", { count: "exact", head: true })
          .eq("complete", false)
          .lte("target_at", terminalOverdueCutoff);
      if (terminalOverdueError) throw terminalOverdueError;

      const ageHours = hoursSince(
        outcomeRun.completed_at ?? outcomeRun.observed_at,
      );
      const fresh =
        !activeMarketSession ||
        ageHours <= ACTIVE_MAX_SHADOW_BOARD_OUTCOMES_AGE_HOURS;
      // A missing in-session minute remains intentionally retryable for seven
      // days so halts and transient provider gaps are not mislabeled as zero
      // returns. Health must use that same terminal contract instead of
      // calling a valid retry state broken after twelve minutes.
      const outcomesCurrent = (terminalOverdueOutcomeCount ?? 0) === 0;
      const outcomeDiagnostics =
        outcomeRun.diagnostics &&
        typeof outcomeRun.diagnostics === "object" &&
        !Array.isArray(outcomeRun.diagnostics)
          ? (outcomeRun.diagnostics as Record<string, unknown>)
          : {};
      const ok = fresh && outcomesCurrent;

      checks.push({
        name: "prox_shadow_board_outcomes",
        ok,
        message: !outcomesCurrent
          ? "Shadow-board outcome tracking has measurements beyond the terminal retry window."
          : !fresh
            ? "Shadow-board outcome tracking is stale during the active market-data session."
            : (retryPendingOutcomeCount ?? 0) > 0
              ? "Shadow-board outcome tracking is fresh and explicitly retrying unresolved market bars."
              : "Shadow-board outcome tracking is fresh and covering every active decision.",
        detail: {
          authority: "shadow_research_only",
          runId: outcomeRun.id,
          engineVersion: outcomeRun.engine_version,
          completedAt: outcomeRun.completed_at,
          ageMinutes: Number.isFinite(ageHours)
            ? Number((ageHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: ACTIVE_MAX_SHADOW_BOARD_OUTCOMES_AGE_HOURS * 60,
          activeMemberCount: outcomeRun.active_member_count,
          updatedMemberCount: outcomeRun.updated_member_count,
          dueOutcomeCount: outcomeRun.due_outcome_count,
          persistedOutcomeCount: outcomeRun.persisted_outcome_count,
          unavailableOutcomeCount: outcomeRun.unavailable_outcome_count,
          retryPendingOutcomeCount: retryPendingOutcomeCount ?? 0,
          terminalOverdueOutcomeCount: terminalOverdueOutcomeCount ?? 0,
          terminalRetryWindowDays:
            PROX_OUTCOME_UNAVAILABLE_AFTER_MS / (24 * 60 * 60_000),
          overdueOutcomeCount: terminalOverdueOutcomeCount ?? 0,
          providerSuccessCount:
            outcomeDiagnostics.providerSuccessCount ?? null,
          providerFailureCount:
            outcomeDiagnostics.providerFailureCount ?? null,
          episodeScorecardMigration:
            "0025_prox_shadow_episode_scorecard.sql",
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "prox_shadow_board_outcomes",
      ok: false,
      message:
        "Shadow-board outcome tracking is unavailable; run migrations 0020 and 0021 before deploying.",
      detail: getErrorMessage(
        err,
        "Unknown Pro X shadow-board outcome health-check error.",
      ),
    });
  }

  // The scorecard must count de-correlated ticker episodes rather than every
  // five-minute board frame. This view is read-only and has no scoring,
  // ranking, public, or execution authority.
  try {
    const scorecardWindowStart = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count: episodeCount, error: episodeError } = await supabase
      .from("prox_shadow_board_episode_representatives")
      .select("*", { count: "exact", head: true })
      .gte("decision_at", scorecardWindowStart);
    if (episodeError) throw episodeError;
    checks.push({
      name: "prox_shadow_episode_scorecard",
      ok: true,
      message:
        "ProX shadow scorecards use de-correlated ticker/session/disposition episodes.",
      detail: {
        authority: "shadow_research_only",
        windowDays: 14,
        episodeCount: episodeCount ?? 0,
        episodeDefinition:
          "first_ticker_date_session_disposition_decision",
      },
    });
  } catch (err: unknown) {
    checks.push({
      name: "prox_shadow_episode_scorecard",
      ok: false,
      message:
        "ProX shadow scorecard episode de-correlation is unavailable; run migration 0025 before deploying.",
      detail: getErrorMessage(
        err,
        "Unknown ProX shadow episode scorecard health-check error.",
      ),
    });
  }

  // Outcome Memory must preserve the original entry, account for every due
  // horizon, and keep MFE/MAE arithmetic honest. Its labels and calibration
  // remain shadow-only and cannot publish another opportunity score.
  try {
    const { data: outcomeRun, error: outcomeRunError } = await supabase
      .from("prox_outcome_memory_runs")
      .select(
        "id,observed_at,completed_at,status,market_session,snapshot_count,active_episode_count,updated_episode_count,due_outcome_count,persisted_outcome_count,unavailable_outcome_count,calibration_count,complete,methodology_version,diagnostics",
      )
      .eq("methodology_version", PROX_OUTCOME_MEMORY_VERSION)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (outcomeRunError) throw outcomeRunError;

    const { data: latestEpisode, error: latestEpisodeError } = await supabase
      .from("prox_research_episodes")
      .select(
        "ticker,started_at,entry_price,sampled_high_price,sampled_low_price,max_gain_percent,max_drawdown_percent,time_to_peak_minutes,outcome_label,status,measurement_quality,updated_at,methodology_version,security_type,instrument_lane",
      )
      .eq("methodology_version", PROX_OUTCOME_MEMORY_VERSION)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestEpisodeError) throw latestEpisodeError;

    if (!outcomeRun) {
      checks.push({
        name: "prox_outcome_memory",
        ok: !activeMarketSession,
        message: activeMarketSession
          ? "Pro X Outcome Memory has no completed active-session cycle."
          : "Pro X Outcome Memory schema is ready and awaiting its next active session.",
        detail: { activeMarketSession, latestEpisode: latestEpisode ?? null },
      });
    } else {
      const runAgeHours = hoursSince(
        outcomeRun.completed_at ?? outcomeRun.observed_at,
      );
      const activeEpisodeCount = Number(outcomeRun.active_episode_count);
      const dueOutcomeCount = Number(outcomeRun.due_outcome_count);
      const persistedOutcomeCount = Number(
        outcomeRun.persisted_outcome_count,
      );
      const unavailableOutcomeCount = Number(
        outcomeRun.unavailable_outcome_count,
      );
      const coverageComplete =
        outcomeRun.status === "success" &&
        outcomeRun.complete === true &&
        dueOutcomeCount ===
          persistedOutcomeCount + unavailableOutcomeCount &&
        (activeEpisodeCount === 0 || Number(outcomeRun.snapshot_count) > 0);
      const fresh =
        !activeMarketSession ||
        runAgeHours <= ACTIVE_MAX_OUTCOME_MEMORY_AGE_HOURS;

      let episodeMathValid = true;
      let episodeDetail: Record<string, unknown> | null = null;
      if (latestEpisode) {
        const entry = Number(latestEpisode.entry_price);
        const high = Number(latestEpisode.sampled_high_price);
        const low = Number(latestEpisode.sampled_low_price);
        const storedGain = Number(latestEpisode.max_gain_percent);
        const storedDrawdown = Number(latestEpisode.max_drawdown_percent);
        const calculatedGain =
          entry > 0 ? ((high - entry) / entry) * 100 : NaN;
        const calculatedDrawdown =
          entry > 0 ? ((low - entry) / entry) * 100 : NaN;
        episodeMathValid =
          entry > 0 &&
          high >= entry &&
          low <= entry &&
          Number.isFinite(calculatedGain) &&
          Number.isFinite(calculatedDrawdown) &&
          Math.abs(storedGain - calculatedGain) <= 0.05 &&
          Math.abs(storedDrawdown - calculatedDrawdown) <= 0.05 &&
          Number(latestEpisode.time_to_peak_minutes) >= 0 &&
          latestEpisode.instrument_lane === "opportunity_equity" &&
          ["CS", "ADRC"].includes(String(latestEpisode.security_type ?? ""));
        episodeDetail = {
          ticker: latestEpisode.ticker,
          startedAt: latestEpisode.started_at,
          entryPrice: entry,
          sampledHighPrice: high,
          sampledLowPrice: low,
          maxGainPercent: storedGain,
          maxDrawdownPercent: storedDrawdown,
          timeToPeakMinutes: latestEpisode.time_to_peak_minutes,
          label: latestEpisode.outcome_label,
          status: latestEpisode.status,
          measurementQuality: latestEpisode.measurement_quality,
          securityType: latestEpisode.security_type,
          instrumentLane: latestEpisode.instrument_lane,
          arithmeticValid: episodeMathValid,
        };
      }

      checks.push({
        name: "prox_outcome_memory",
        ok: coverageComplete && fresh && episodeMathValid,
        message: !coverageComplete
          ? "Pro X Outcome Memory failed its due-horizon coverage receipt."
          : !fresh
            ? "Pro X Outcome Memory is stale during the active market-data session."
            : !episodeMathValid
              ? "Pro X Outcome Memory contains invalid equity routing, entry, MFE, or MAE arithmetic."
              : activeMarketSession
                ? "Pro X Outcome Memory is fresh, complete, and arithmetically valid."
                : "Latest Pro X Outcome Memory cycle is retained outside the active session.",
        detail: {
          runId: outcomeRun.id,
          methodologyVersion: outcomeRun.methodology_version,
          marketSession: outcomeRun.market_session,
          activeEpisodeCount,
          updatedEpisodeCount: Number(outcomeRun.updated_episode_count),
          dueOutcomeCount,
          persistedOutcomeCount,
          unavailableOutcomeCount,
          calibrationCount: Number(outcomeRun.calibration_count),
          completedAt: outcomeRun.completed_at,
          ageMinutes: Number.isFinite(runAgeHours)
            ? Number((runAgeHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: activeMarketSession
            ? ACTIVE_MAX_OUTCOME_MEMORY_AGE_HOURS * 60
            : null,
          episode: episodeDetail,
          authority:
            outcomeRun.diagnostics &&
            typeof outcomeRun.diagnostics === "object" &&
            "authority" in outcomeRun.diagnostics
              ? outcomeRun.diagnostics.authority
              : null,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "prox_outcome_memory",
      ok: false,
      message:
        "Pro X Outcome Memory is unavailable; run migration 0014 after migration 0013.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Canonical Transition Memory must preserve the real Before The Crowd entry,
  // the later Spot Momentum promotion, and the outcome from the earlier entry.
  // It is evidence for Pro X research only, never another public score.
  try {
    const { data: transitionRun, error: transitionRunError } = await supabase
      .from("prox_strategy_transition_runs")
      .select(
        "id,observed_at,trading_date,methodology_version,source_pair_count,persisted_case_count,complete,case_tickers,diagnostics,error_message",
      )
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (transitionRunError) throw transitionRunError;

    const { data: latestTransition, error: latestTransitionError } =
      await supabase
        .from("prox_strategy_transition_cases")
        .select(
          "ticker,trading_date,source_kind,before_crowd_first_at,before_crowd_first_price,spot_first_at,spot_first_price,transition_minutes,transition_return_percent,highest_price_after_early,highest_price_at,lowest_price_after_early,lowest_price_at,max_gain_from_early_percent,max_drawdown_from_early_percent,max_gain_from_spot_percent,time_from_early_to_peak_minutes,case_label,status,calibratable,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latestTransitionError) throw latestTransitionError;

    if (!transitionRun) {
      checks.push({
        name: "prox_canonical_transition_memory",
        ok: false,
        message:
          "Canonical Transition Memory has no coverage receipt; run migration 0015.",
      });
    } else {
      const runAgeHours = hoursSince(transitionRun.observed_at);
      const sourcePairCount = Number(transitionRun.source_pair_count);
      const persistedCaseCount = Number(transitionRun.persisted_case_count);
      const coverageValid =
        transitionRun.complete === true &&
        sourcePairCount === persistedCaseCount;
      const fresh =
        !activeMarketSession ||
        runAgeHours <= ACTIVE_MAX_TRANSITION_MEMORY_AGE_HOURS;

      let arithmeticValid = sourcePairCount === 0 && !latestTransition;
      let transitionDetail: Record<string, unknown> | null = null;
      if (latestTransition) {
        const beforeAt = new Date(
          latestTransition.before_crowd_first_at,
        ).getTime();
        const spotAt = new Date(latestTransition.spot_first_at).getTime();
        const beforePrice = Number(
          latestTransition.before_crowd_first_price,
        );
        const spotPrice = Number(latestTransition.spot_first_price);
        const high = Number(latestTransition.highest_price_after_early);
        const low = Number(latestTransition.lowest_price_after_early);
        const calculatedMinutes = (spotAt - beforeAt) / 60_000;
        const calculatedTransitionReturn =
          ((spotPrice - beforePrice) / beforePrice) * 100;
        const calculatedEarlyGain =
          ((high - beforePrice) / beforePrice) * 100;
        const calculatedEarlyDrawdown =
          ((low - beforePrice) / beforePrice) * 100;
        const calculatedSpotGain = ((high - spotPrice) / spotPrice) * 100;
        arithmeticValid =
          latestTransition.source_kind === "canonical_transition_case" &&
          latestTransition.calibratable === false &&
          beforePrice > 0 &&
          spotPrice > 0 &&
          spotAt > beforeAt &&
          high >= beforePrice &&
          low > 0 &&
          low <= beforePrice &&
          Math.abs(
            Number(latestTransition.transition_minutes) - calculatedMinutes,
          ) <= 0.11 &&
          Math.abs(
            Number(latestTransition.transition_return_percent) -
              calculatedTransitionReturn,
          ) <= 0.05 &&
          Math.abs(
            Number(latestTransition.max_gain_from_early_percent) -
              calculatedEarlyGain,
          ) <= 0.05 &&
          Math.abs(
            Number(latestTransition.max_drawdown_from_early_percent) -
              calculatedEarlyDrawdown,
          ) <= 0.05 &&
          Math.abs(
            Number(latestTransition.max_gain_from_spot_percent) -
              calculatedSpotGain,
          ) <= 0.05 &&
          Number(latestTransition.time_from_early_to_peak_minutes) >= 0;
        transitionDetail = {
          ticker: latestTransition.ticker,
          tradingDate: latestTransition.trading_date,
          beforeCrowdFirstAt: latestTransition.before_crowd_first_at,
          beforeCrowdFirstPrice: beforePrice,
          spotFirstAt: latestTransition.spot_first_at,
          spotFirstPrice: spotPrice,
          transitionMinutes: Number(latestTransition.transition_minutes),
          transitionReturnPercent: Number(
            latestTransition.transition_return_percent,
          ),
          highestPriceAfterEarly: high,
          maxGainFromEarlyPercent: Number(
            latestTransition.max_gain_from_early_percent,
          ),
          maxGainFromSpotPercent: Number(
            latestTransition.max_gain_from_spot_percent,
          ),
          maxDrawdownFromEarlyPercent: Number(
            latestTransition.max_drawdown_from_early_percent,
          ),
          label: latestTransition.case_label,
          status: latestTransition.status,
          arithmeticValid,
        };
      }

      checks.push({
        name: "prox_canonical_transition_memory",
        ok: coverageValid && fresh && arithmeticValid,
        message: !coverageValid
          ? "Canonical Transition Memory failed its source-pair coverage receipt."
          : !fresh
            ? "Canonical Transition Memory is stale during the active market-data session."
            : !arithmeticValid
              ? "Canonical Transition Memory contains invalid transition or outcome arithmetic."
              : sourcePairCount === 0
                ? "Canonical Transition Memory is healthy; no graduated cases exist in the latest receipt."
                : "Canonical Transition Memory is fresh, complete, and arithmetically valid.",
        detail: {
          runId: transitionRun.id,
          tradingDate: transitionRun.trading_date,
          methodologyVersion: transitionRun.methodology_version,
          sourcePairCount,
          persistedCaseCount,
          completed: transitionRun.complete,
          observedAt: transitionRun.observed_at,
          ageMinutes: Number.isFinite(runAgeHours)
            ? Number((runAgeHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: activeMarketSession
            ? ACTIVE_MAX_TRANSITION_MEMORY_AGE_HOURS * 60
            : null,
          transition: transitionDetail,
          authority:
            transitionRun.diagnostics &&
            typeof transitionRun.diagnostics === "object" &&
            "authority" in transitionRun.diagnostics
              ? transitionRun.diagnostics.authority
              : null,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "prox_canonical_transition_memory",
      ok: false,
      message:
        "Canonical Transition Memory is unavailable; run migration 0015 after migrations 0010 and 0014.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Transition Calibration must include every finalized Before The Crowd case,
  // not only winners that graduated. Cohort rates remain shadow evidence and
  // cannot modify the one canonical HT score.
  try {
    const { data: calibrationRun, error: calibrationRunError } = await supabase
      .from("prox_transition_calibration_runs")
      .select(
        "id,observed_at,completed_at,trading_date,methodology_version,source_case_count,mature_case_count,expected_cohort_count,persisted_cohort_count,emerging_cohort_count,calibrated_cohort_count,complete,diagnostics,error_message",
      )
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (calibrationRunError) throw calibrationRunError;

    if (!calibrationRun) {
      checks.push({
        name: "prox_transition_pattern_calibration",
        ok: false,
        message:
          "Pro X Transition Calibration has no coverage receipt; run migration 0016 and deploy its scheduled route.",
      });
    } else {
      const [sourceResult, matureResult, cohortResult, latestResult] =
        await Promise.all([
          supabase
            .from("prox_strategy_learning_cases")
            .select("*", { count: "exact", head: true })
            .eq("methodology_version", "prox-transition-learning-case-v1"),
          supabase
            .from("prox_strategy_learning_cases")
            .select("*", { count: "exact", head: true })
            .eq("methodology_version", "prox-transition-learning-case-v1")
            .eq("status", "complete")
            .eq("calibratable", true),
          supabase
            .from("prox_transition_pattern_calibrations")
            .select("*", { count: "exact", head: true })
            .eq("methodology_version", "prox-transition-calibration-v1"),
          supabase
            .from("prox_transition_pattern_calibrations")
            .select(
              "cohort_key,cohort_level,sample_size,graduated_count,graduation_rate,explosion_count,explosion_rate,continuation_count,continuation_rate,failure_count,failure_rate,missed_explosion_count,missed_explosion_rate,median_max_gain_percent,median_max_drawdown_percent,median_time_to_peak_minutes,median_transition_minutes,evidence_state,authority,computed_at",
            )
            .eq("methodology_version", "prox-transition-calibration-v1")
            .order("sample_size", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (sourceResult.error) throw sourceResult.error;
      if (matureResult.error) throw matureResult.error;
      if (cohortResult.error) throw cohortResult.error;
      if (latestResult.error) throw latestResult.error;

      const sourceCaseCount = Number(calibrationRun.source_case_count);
      const matureCaseCount = Number(calibrationRun.mature_case_count);
      const expectedCohortCount = Number(
        calibrationRun.expected_cohort_count,
      );
      const persistedCohortCount = Number(
        calibrationRun.persisted_cohort_count,
      );
      const actualSourceCount = sourceResult.count ?? 0;
      const actualMatureCount = matureResult.count ?? 0;
      const actualCohortCount = cohortResult.count ?? 0;
      const coverageValid =
        calibrationRun.complete === true &&
        sourceCaseCount === actualSourceCount &&
        matureCaseCount === actualMatureCount &&
        expectedCohortCount === persistedCohortCount &&
        persistedCohortCount === actualCohortCount;
      const ageHours = hoursSince(
        calibrationRun.completed_at ?? calibrationRun.observed_at,
      );
      const fresh =
        !activeMarketSession ||
        ageHours <= ACTIVE_MAX_TRANSITION_CALIBRATION_AGE_HOURS;

      const latest = latestResult.data;
      let arithmeticValid = expectedCohortCount === 0 && !latest;
      let cohortDetail: Record<string, unknown> | null = null;
      if (latest) {
        const sampleSize = Number(latest.sample_size);
        const countRatePairs = [
          [latest.graduated_count, latest.graduation_rate],
          [latest.explosion_count, latest.explosion_rate],
          [latest.continuation_count, latest.continuation_rate],
          [latest.failure_count, latest.failure_rate],
          [latest.missed_explosion_count, latest.missed_explosion_rate],
        ].map(([count, rate]) => [Number(count), Number(rate)] as const);
        const expectedEvidenceState =
          sampleSize >= 100
            ? "calibrated"
            : sampleSize >= 30
              ? "emerging"
              : "insufficient";
        arithmeticValid =
          sampleSize > 0 &&
          latest.authority === "shadow_research_only" &&
          latest.evidence_state === expectedEvidenceState &&
          countRatePairs.every(
            ([count, rate]) =>
              count >= 0 &&
              count <= sampleSize &&
              rate >= 0 &&
              rate <= 1 &&
              Math.abs(rate - count / sampleSize) <= 0.001,
          ) &&
          Number(latest.missed_explosion_count) <=
            Number(latest.explosion_count) &&
          Number(latest.median_time_to_peak_minutes) >= 0 &&
          (latest.median_transition_minutes === null ||
            Number(latest.median_transition_minutes) > 0);
        cohortDetail = {
          cohortKey: latest.cohort_key,
          cohortLevel: latest.cohort_level,
          sampleSize,
          graduationRate: Number(latest.graduation_rate),
          explosionRate: Number(latest.explosion_rate),
          continuationRate: Number(latest.continuation_rate),
          failureRate: Number(latest.failure_rate),
          missedExplosionRate: Number(latest.missed_explosion_rate),
          medianMaxGainPercent: Number(latest.median_max_gain_percent),
          medianMaxDrawdownPercent: Number(
            latest.median_max_drawdown_percent,
          ),
          medianTimeToPeakMinutes: Number(
            latest.median_time_to_peak_minutes,
          ),
          evidenceState: latest.evidence_state,
          arithmeticValid,
        };
      }

      checks.push({
        name: "prox_transition_pattern_calibration",
        ok: coverageValid && fresh && arithmeticValid,
        message: !coverageValid
          ? "Pro X Transition Calibration failed its learning-case or cohort coverage receipt."
          : !fresh
            ? "Pro X Transition Calibration is stale during the active market-data session."
            : !arithmeticValid
              ? "Pro X Transition Calibration contains invalid rates, thresholds, or cohort arithmetic."
              : expectedCohortCount === 0
                ? "Pro X Transition Calibration is healthy and awaiting finalized learning cases."
                : "Pro X Transition Calibration is fresh, denominator-complete, and arithmetically valid.",
        detail: {
          runId: calibrationRun.id,
          tradingDate: calibrationRun.trading_date,
          methodologyVersion: calibrationRun.methodology_version,
          sourceCaseCount,
          actualSourceCount,
          matureCaseCount,
          actualMatureCount,
          expectedCohortCount,
          persistedCohortCount,
          actualCohortCount,
          emergingCohortCount: Number(
            calibrationRun.emerging_cohort_count,
          ),
          calibratedCohortCount: Number(
            calibrationRun.calibrated_cohort_count,
          ),
          completedAt: calibrationRun.completed_at,
          ageMinutes: Number.isFinite(ageHours)
            ? Number((ageHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: activeMarketSession
            ? ACTIVE_MAX_TRANSITION_CALIBRATION_AGE_HOURS * 60
            : null,
          denominator: "all_finalized_before_the_crowd_cases",
          cohort: cohortDetail,
          authority:
            calibrationRun.diagnostics &&
            typeof calibrationRun.diagnostics === "object" &&
            "authority" in calibrationRun.diagnostics
              ? calibrationRun.diagnostics.authority
              : null,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "prox_transition_pattern_calibration",
      ok: false,
      message:
        "Pro X Transition Calibration is unavailable; run migration 0016 after migrations 0010 and 0015.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const [
      accountSchema,
      positionSchema,
      orderSchema,
      fillSchema,
      latestMatch,
    ] = await Promise.all([
      supabase.from("paper_accounts").select("*", { count: "exact", head: true }),
      supabase.from("paper_positions").select("*", { count: "exact", head: true }),
      supabase.from("paper_orders").select("*", { count: "exact", head: true }),
      supabase.from("paper_fills").select("*", { count: "exact", head: true }),
      supabase
        .from("paper_match_runs")
        .select("id,started_at,completed_at,status,market_session,examined_count,filled_count,expired_count,rejected_count,skipped_count,diagnostics")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const schemaError = [
      accountSchema.error,
      positionSchema.error,
      orderSchema.error,
      fillSchema.error,
      latestMatch.error,
    ].find(Boolean);
    if (schemaError) throw schemaError;

    const match = latestMatch.data;
    const ageHours = hoursSince(match?.completed_at ?? match?.started_at);
    const matcherHealthy = Boolean(
      match &&
      match.status === "success" &&
      match.completed_at &&
      ageHours <= MAX_PAPER_MATCH_AGE_HOURS,
    );
    checks.push({
      name: "paper_trading_contract_and_matcher",
      ok: matcherHealthy,
      message: !match
        ? "Paper Trading schema is ready, but the scheduled matcher has no heartbeat yet."
        : match.status !== "success"
          ? "The latest Paper Trading matcher run did not complete successfully."
          : ageHours > MAX_PAPER_MATCH_AGE_HOURS
            ? "The Paper Trading matcher heartbeat is stale."
            : "Paper Trading v2 and its scheduled order matcher are healthy.",
      detail: {
        contractVersion: PAPER_TRADING_CONTRACT_VERSION,
        accountCount: accountSchema.count ?? 0,
        positionCount: positionSchema.count ?? 0,
        orderCount: orderSchema.count ?? 0,
        fillCount: fillSchema.count ?? 0,
        matcherRun: match ? {
          id: match.id,
          status: match.status,
          marketSession: match.market_session,
          examined: match.examined_count,
          filled: match.filled_count,
          expired: match.expired_count,
          rejected: match.rejected_count,
          skipped: match.skipped_count,
          completedAt: match.completed_at,
          ageMinutes: Number.isFinite(ageHours)
            ? Number((ageHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: MAX_PAPER_MATCH_AGE_HOURS * 60,
          authority:
            match.diagnostics && typeof match.diagnostics === "object" &&
            "authority" in match.diagnostics
              ? match.diagnostics.authority
              : null,
        } : null,
      },
    });
  } catch (err: unknown) {
    checks.push({
      name: "paper_trading_contract_and_matcher",
      ok: false,
      message:
        "Paper Trading health receipts are unavailable; apply migrations 0024 and 0028 before syncing iOS.",
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

  // The UI must never receive a different price/change than the one that
  // earned qualification. This executes the same server-owned builder used by
  // Home, Scanner, ledger collection, and the paper bot, then fails health if
  // any qualified record is non-positive, post-quote divergent, peak-failed,
  // or if an entry-withheld contender carries invalid radar authority.
  try {
    const feed = await getRollingCanonicalDecisionFrame("momentum");
    const audit = auditCanonicalSpotMomentumFeed(feed);
    const topDecisionSet = [
      feed.opportunities[0],
      ...("momentumContenders" in feed ? feed.momentumContenders : []),
    ].filter(Boolean);
    const liveQuoteCount = topDecisionSet.filter(
      (record) => record.displayQuoteLive === true,
    ).length;
    const directQuoteCoverage =
      !activeMarketSession ||
      (topDecisionSet.length > 0 && liveQuoteCount === topDecisionSet.length);
    const marketTimestampCoverage =
      !activeMarketSession ||
      (topDecisionSet.length > 0 &&
        topDecisionSet.every(
          (record) =>
            getDecisionFrameMarketTimingFreshness({
              opportunities: [record],
              momentumContenders: [],
            }).fresh,
        ));
    const proxAuthorityRecords = topDecisionSet.filter(
      (record) => record.proxIntelligence !== null,
    );
    const proxAuthorityCoverage =
      topDecisionSet.length > 0 &&
      proxAuthorityRecords.length === topDecisionSet.length &&
      proxAuthorityRecords.every(
        (record) =>
          record.proxIntelligence?.authority.version ===
            PROX_PUBLIC_AUTHORITY_VERSION &&
          record.proxIntelligence.authority.marketPulse ===
            PROX_PUBLIC_AUTHORITY_CONTRACT.marketPulse &&
          record.proxIntelligence.authority.eventEvidence ===
            PROX_PUBLIC_AUTHORITY_CONTRACT.eventEvidence &&
          record.proxIntelligence.authority.transitionEvidence ===
            PROX_PUBLIC_AUTHORITY_CONTRACT.transitionEvidence &&
          record.proxIntelligence.authority.deepSessionRecovery ===
            PROX_PUBLIC_AUTHORITY_CONTRACT.deepSessionRecovery &&
          record.proxIntelligence.authority.execution === "none" &&
          record.proxIntelligence.authority.liveTrading === "disabled" &&
          record.scoreContext.proxAuthorityVersion ===
            PROX_PUBLIC_AUTHORITY_VERSION,
      );
    checks.push({
      name: "canonical_opportunity_atomicity",
      ok: audit.ok && feed.decisionFrame.fresh && marketTimestampCoverage,
      message: !audit.ok
        ? "Canonical Spot Momentum contains a quote, eligibility, rank, or radar-authority mismatch."
        : !feed.decisionFrame.fresh
          ? "The rolling canonical decision frame exceeded its strict freshness window."
        : !marketTimestampCoverage
          ? "Canonical and ProX market facts are stale, missing, or refer to different market moments."
        : directQuoteCoverage
          ? "Canonical Spot Momentum scoring, ranking, and display use one fresh rolling decision frame."
          : "Canonical Spot Momentum remains atomic; unavailable direct quote refreshes retain the fresh promoted-run decision.",
      detail: {
        engineVersion: feed.engineVersion,
        sourceRunId: "sourceRun" in feed ? feed.sourceRun.id : null,
        decisionFrame: feed.decisionFrame,
        qualifiedCount: audit.qualifiedCount,
        contenderCount: audit.contenderCount,
        radarCount: audit.radarCount,
        topDecisionCount: topDecisionSet.length,
        liveDecisionQuoteCount: liveQuoteCount,
        directQuoteCoverage,
        marketTimestampCoverage,
        marketTimestamps: topDecisionSet.slice(0, 6).map((record) => ({
          ticker: record.ticker,
          canonicalMarketAsOf: record.decisionQuoteAsOf ?? null,
          proxMarketAsOf: record.proxIntelligence?.pulse?.marketAsOf ?? null,
          aligned: record.scoreContext.proxMarketDataAligned ?? false,
          skewSeconds:
            record.scoreContext.proxMarketDataSkewSeconds ?? null,
        })),
        canonicalFallbackCount: topDecisionSet.length - liveQuoteCount,
        issues: audit.issues.slice(0, 20),
      },
    });
    checks.push({
      name: "prox_public_authority_contract",
      ok: proxAuthorityCoverage,
      message: proxAuthorityCoverage
        ? "ProX market authority is bounded, versioned, and separated from research and execution."
        : "Canonical decisions do not all carry the current bounded ProX authority contract.",
      detail: {
        authorityVersion: PROX_PUBLIC_AUTHORITY_VERSION,
        topDecisionCount: topDecisionSet.length,
        coveredDecisionCount: proxAuthorityRecords.length,
        marketPulse: PROX_PUBLIC_AUTHORITY_CONTRACT.marketPulse,
        eventEvidence: PROX_PUBLIC_AUTHORITY_CONTRACT.eventEvidence,
        transitionEvidence:
          PROX_PUBLIC_AUTHORITY_CONTRACT.transitionEvidence,
        maximumSupportAdjustment:
          PROX_PUBLIC_AUTHORITY_CONTRACT.maximumSupportAdjustment,
        maximumOrdinaryPenalty:
          PROX_PUBLIC_AUTHORITY_CONTRACT.maximumOrdinaryPenalty,
        confirmedPeakFailure:
          PROX_PUBLIC_AUTHORITY_CONTRACT.confirmedPeakFailure,
        deepSessionRecovery:
          PROX_PUBLIC_AUTHORITY_CONTRACT.deepSessionRecovery,
        execution: PROX_PUBLIC_AUTHORITY_CONTRACT.execution,
        liveTrading: PROX_PUBLIC_AUTHORITY_CONTRACT.liveTrading,
      },
    });
  } catch (err: unknown) {
    checks.push({
      name: "canonical_opportunity_atomicity",
      ok: false,
      message: "Could not verify canonical Spot Momentum quote and ranking atomicity.",
      detail: err instanceof Error ? err.message : String(err),
    });
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

  // A healthy latest row is not enough to prove that the complete displayed
  // set was captured. The collection receipt and observation history must
  // agree on the exact number of server-selected records for both strategies.
  try {
    const tradingDate = easternDateString();
    const { data: collectionRun, error: collectionRunError } = await supabase
      .from("ht_opportunity_collection_runs")
      .select(
        "observed_at,observation_minute,spot_momentum_count,before_crowd_count,expected_observation_count,persisted_observation_count,complete,spot_momentum_tickers,before_crowd_tickers",
      )
      .eq("trading_date", tradingDate)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (collectionRunError) throw collectionRunError;

    if (!collectionRun) {
      const coverageExpected = activeMarketSession && displayableCount > 0;
      checks.push({
        name: "opportunity_observation_coverage",
        ok: !coverageExpected,
        message: coverageExpected
          ? "No complete opportunity-observation receipt exists for the active session."
          : "Opportunity observation schema is ready and awaiting its next collection cycle.",
        detail: { tradingDate, activeMarketSession, displayableCount },
      });
    } else {
      const { data: actualObservations, error: observationReadError } =
        await supabase
          .from("ht_opportunity_observations")
          .select("ticker,strategy,role,rank,source_run_id")
          .eq("observation_minute", collectionRun.observation_minute)
          .order("strategy", { ascending: true })
          .order("rank", { ascending: true });
      if (observationReadError) throw observationReadError;

      const spotTickers = Array.isArray(collectionRun.spot_momentum_tickers)
        ? collectionRun.spot_momentum_tickers as Array<{
            ticker?: unknown;
            rank?: unknown;
            role?: unknown;
            sourceRunId?: unknown;
          }>
        : [];
      const beforeCrowdTickers = Array.isArray(
        collectionRun.before_crowd_tickers,
      )
        ? collectionRun.before_crowd_tickers as Array<{
            ticker?: unknown;
            rank?: unknown;
            role?: unknown;
            sourceRunId?: unknown;
          }>
        : [];
      const spotCount = Number(collectionRun.spot_momentum_count);
      const beforeCrowdCount = Number(collectionRun.before_crowd_count);
      const expectedCount = Number(collectionRun.expected_observation_count);
      const persistedCount = Number(collectionRun.persisted_observation_count);
      const actualCount = actualObservations?.length ?? 0;
      const collectionAgeHours = hoursSince(collectionRun.observed_at);
      const fresh =
        !activeMarketSession ||
        collectionAgeHours <= ACTIVE_MAX_LEDGER_AGE_HOURS;
      const coverageComplete =
        collectionRun.complete === true &&
        expectedCount === persistedCount &&
        persistedCount === actualCount &&
        spotCount === spotTickers.length &&
        beforeCrowdCount === beforeCrowdTickers.length &&
        expectedCount === spotCount + beforeCrowdCount;
      type CoverageRow = {
        ticker?: unknown;
        rank?: unknown;
        role?: unknown;
        sourceRunId?: unknown;
      };
      const normalizeCoverageRows = (rows: CoverageRow[]) =>
        rows.map((row) => ({
          ticker: String(row.ticker ?? "").trim().toUpperCase(),
          rank: Number(row.rank),
          role: String(row.role ?? ""),
          sourceRunId:
            row.sourceRunId === null || row.sourceRunId === undefined
              ? null
              : String(row.sourceRunId),
        }));
      const uniqueAndRanked = (rows: CoverageRow[]) => {
        const normalized = normalizeCoverageRows(rows);
        const tickers = normalized.map((row) => row.ticker);
        const ranks = normalized.map((row) => row.rank);
        return (
          tickers.every(Boolean) &&
          new Set(tickers).size === tickers.length &&
          ranks.every((rank, index) => rank === index + 1)
        );
      };
      const exactSetShape =
        uniqueAndRanked(spotTickers) && uniqueAndRanked(beforeCrowdTickers);
      const actualSpotRows = (actualObservations ?? [])
        .filter((row) => row.strategy === "spot_momentum")
        .map((row) => ({
          ticker: row.ticker,
          rank: row.rank,
          role: row.role,
          sourceRunId: row.source_run_id,
        }));
      const actualBeforeCrowdRows = (actualObservations ?? [])
        .filter((row) => row.strategy === "before_the_crowd")
        .map((row) => ({
          ticker: row.ticker,
          rank: row.rank,
          role: row.role,
          sourceRunId: row.source_run_id,
        }));
      const exactTickerSetsPersisted =
        JSON.stringify(normalizeCoverageRows(spotTickers)) ===
          JSON.stringify(normalizeCoverageRows(actualSpotRows)) &&
        JSON.stringify(normalizeCoverageRows(beforeCrowdTickers)) ===
          JSON.stringify(normalizeCoverageRows(actualBeforeCrowdRows));

      checks.push({
        name: "opportunity_observation_coverage",
        ok:
          coverageComplete &&
          exactSetShape &&
          exactTickerSetsPersisted &&
          fresh,
        message: !coverageComplete
          ? "The latest collection receipt does not match persisted opportunity observations."
          : !exactSetShape
            ? "The latest saved opportunity set has duplicate tickers or non-canonical ranks."
            : !exactTickerSetsPersisted
              ? "The saved observation tickers do not exactly match the canonical collection receipt."
              : !fresh
                ? "The latest complete opportunity-observation set is stale."
                : "The exact current strategy sets and their full decision observations were persisted.",
        detail: {
          tradingDate,
          observedAt: collectionRun.observed_at,
          spotMomentumCount: spotCount,
          beforeCrowdCount,
          expectedCount,
          persistedCount,
          actualCount,
          complete: collectionRun.complete,
          exactTickerSetsPersisted,
          ageMinutes: Number.isFinite(collectionAgeHours)
            ? Number((collectionAgeHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: ACTIVE_MAX_LEDGER_AGE_HOURS * 60,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "opportunity_observation_coverage",
      ok: false,
      message: "Opportunity observation history is unavailable; run migration 0010 before deploying.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Crypto has no market close. A healthy 24/7 ProX lane must prove the
  // complete saved set, packet coverage, freshness, and timed-outcome writes.
  try {
    const { data: cryptoRun, error: cryptoRunError } = await supabase
      .from("ht_crypto_prox_collection_runs")
      .select(
        "observed_at,observation_minute,expected_observation_count,persisted_observation_count,complete,observed_products,feed_diagnostics,outcomes_updated",
      )
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cryptoRunError) throw cryptoRunError;

    if (!cryptoRun) {
      checks.push({
        name: "crypto_prox_observation_pipeline",
        ok: false,
        message: "Crypto ProX has no completed 24/7 observation cycle yet.",
      });
    } else {
      const { data: cryptoObservations, error: cryptoObservationError } =
        await supabase
          .from("ht_crypto_prox_observations")
          .select("product_id,symbol,role,rank,prox_state,prox_packet")
          .eq("observation_minute", cryptoRun.observation_minute);
      if (cryptoObservationError) throw cryptoObservationError;
      const overdueCutoff = new Date(
        Date.now() - CRYPTO_OUTCOME_GRACE_MINUTES * 60_000,
      ).toISOString();
      const { count: overdueOutcomeCount, error: overdueOutcomeError } =
        await supabase
          .from("ht_crypto_prox_observations")
          .select("*", { count: "exact", head: true })
          .is("price_15m", null)
          .lte("target_15m_at", overdueCutoff);
      if (overdueOutcomeError) throw overdueOutcomeError;

      type CryptoCoverageRow = {
        productId?: unknown;
        symbol?: unknown;
        role?: unknown;
        rank?: unknown;
      };
      const roleOrder = new Map([
        ["hero", 0],
        ["contender", 1],
        ["radar", 2],
      ]);
      const normalizeCryptoRows = (rows: CryptoCoverageRow[]) =>
        rows.map((row) => ({
          productId: String(row.productId ?? "").trim(),
          symbol: String(row.symbol ?? "").trim().toUpperCase(),
          role: String(row.role ?? ""),
          rank: Number(row.rank),
        })).sort((left, right) =>
          (roleOrder.get(left.role) ?? 99) -
            (roleOrder.get(right.role) ?? 99) ||
          left.rank - right.rank ||
          left.productId.localeCompare(right.productId),
        );
      const receiptRows = Array.isArray(cryptoRun.observed_products)
        ? cryptoRun.observed_products as CryptoCoverageRow[]
        : [];
      const actualRows = (cryptoObservations ?? []).map((row) => ({
        productId: row.product_id,
        symbol: row.symbol,
        role: row.role,
        rank: row.rank,
      }));
      const exactCryptoSet =
        JSON.stringify(normalizeCryptoRows(receiptRows)) ===
        JSON.stringify(normalizeCryptoRows(actualRows));
      const expectedCount = Number(cryptoRun.expected_observation_count);
      const persistedCount = Number(cryptoRun.persisted_observation_count);
      const actualCount = cryptoObservations?.length ?? 0;
      const feedDiagnostics = cryptoRun.feed_diagnostics &&
          typeof cryptoRun.feed_diagnostics === "object" &&
          !Array.isArray(cryptoRun.feed_diagnostics)
        ? cryptoRun.feed_diagnostics as Record<string, unknown>
        : {};
      const evaluatedProducts = Number(feedDiagnostics.evaluatedProducts);
      const providerFailures = Number(feedDiagnostics.providerFailures);
      const proxEvaluatedProducts = Number(
        feedDiagnostics.proxEvaluatedProducts,
      );
      const proxAvailableProducts = Number(
        feedDiagnostics.proxAvailableProducts,
      );
      const proxProviderFailures = Number(
        feedDiagnostics.proxProviderFailures,
      );
      const providerHealthy =
        evaluatedProducts > 0 &&
        providerFailures === 0 &&
        proxEvaluatedProducts > 0 &&
        proxAvailableProducts === proxEvaluatedProducts &&
        proxProviderFailures === 0;
      const cryptoRunAgeHours = hoursSince(cryptoRun.observed_at);
      const fresh = cryptoRunAgeHours <= MAX_CRYPTO_PROX_AGE_HOURS;
      const packetCoverage = (cryptoObservations ?? []).every((row) => {
        const packet = row.prox_packet && typeof row.prox_packet === "object"
          ? row.prox_packet as {
              mode?: unknown;
              packetVersion?: unknown;
              fresh?: unknown;
              state?: unknown;
            }
          : null;
        const requiresFreshAuthority = row.role === "hero" || row.role === "contender";
        return Boolean(
          row.prox_state &&
          packet?.mode === "bounded_authority" &&
          packet.packetVersion === "crypto-prox-v2" &&
          (!requiresFreshAuthority ||
            (packet.fresh === true &&
              packet.state !== "stale" &&
              packet.state !== "weakening")),
        );
      });
      const complete =
        cryptoRun.complete === true &&
        expectedCount === persistedCount &&
        persistedCount === actualCount;
      const outcomesCurrent = (overdueOutcomeCount ?? 0) === 0;

      checks.push({
        name: "crypto_prox_observation_pipeline",
        ok:
          complete &&
          providerHealthy &&
          exactCryptoSet &&
          packetCoverage &&
          outcomesCurrent &&
          fresh,
        message: !complete
          ? "The latest Crypto ProX receipt does not match its persisted row count."
          : !providerHealthy
            ? "The latest Crypto ProX cycle did not receive complete provider and ProX coverage."
            : !exactCryptoSet
              ? "The persisted Crypto ProX products do not match the collection receipt."
              : !packetCoverage
                ? "One or more current crypto opportunities is missing a valid bounded-authority ProX packet."
                : !outcomesCurrent
                  ? "Crypto ProX has overdue 15-minute outcome observations."
                  : !fresh
                    ? "The latest Crypto ProX observation cycle is stale."
                    : "Crypto ProX is fresh, complete, exact-set verified, and recording timed outcomes.",
        detail: {
          observedAt: cryptoRun.observed_at,
          expectedCount,
          persistedCount,
          actualCount,
          providerHealthy,
          evaluatedProducts,
          providerFailures,
          proxEvaluatedProducts,
          proxAvailableProducts,
          proxProviderFailures,
          exactCryptoSet,
          packetCoverage,
          overdue15mOutcomes: overdueOutcomeCount ?? 0,
          outcomesUpdatedThisCycle: cryptoRun.outcomes_updated,
          ageMinutes: Number.isFinite(cryptoRunAgeHours)
            ? Number((cryptoRunAgeHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: MAX_CRYPTO_PROX_AGE_HOURS * 60,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "crypto_prox_observation_pipeline",
      ok: false,
      message: "Crypto ProX history is unavailable; run migration 0011 before deploying.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Home, Crypto, and mobile must consume one complete backend frame. A
  // healthy provider scan is not sufficient if the public decision itself is
  // missing, expired, hybrid, or grants authority to stale live-tape data.
  try {
    const { data: cryptoFrame, error: cryptoFrameError } = await supabase
      .from("ht_crypto_decision_frames")
      .select(
        "decision_at,fresh_until,methodology_version,expected_opportunity_count,complete,feed,diagnostics",
      )
      .eq("complete", true)
      .order("decision_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cryptoFrameError) throw cryptoFrameError;
    if (!cryptoFrame) {
      checks.push({
        name: "crypto_atomic_decision_frame",
        ok: false,
        message: "Crypto has no completed backend decision frame yet.",
      });
    } else {
      const feed = cryptoFrame.feed && typeof cryptoFrame.feed === "object" &&
          !Array.isArray(cryptoFrame.feed)
        ? cryptoFrame.feed as Record<string, unknown>
        : {};
      const frame = feed.decisionFrame &&
          typeof feed.decisionFrame === "object" &&
          !Array.isArray(feed.decisionFrame)
        ? feed.decisionFrame as Record<string, unknown>
        : {};
      const hero = feed.hero && typeof feed.hero === "object" &&
          !Array.isArray(feed.hero)
        ? feed.hero as Record<string, unknown>
        : null;
      const contenders = Array.isArray(feed.contenders)
        ? feed.contenders as Array<Record<string, unknown>>
        : [];
      const radar = Array.isArray(feed.radar)
        ? feed.radar as Array<Record<string, unknown>>
        : [];
      const actualOpportunityCount = Number(hero !== null) +
        contenders.length + radar.length;
      const expectedOpportunityCount = Number(
        cryptoFrame.expected_opportunity_count,
      );
      const decisionAgeMinutes = hoursSince(cryptoFrame.decision_at) * 60;
      const freshUntilMs = new Date(cryptoFrame.fresh_until).getTime();
      const frameFresh = Number.isFinite(freshUntilMs) && freshUntilMs >= Date.now();
      const authorityRows = [...(hero ? [hero] : []), ...contenders];
      const authorityValid = authorityRows.every((opportunity) => {
        const packet = opportunity.proxIntelligence &&
            typeof opportunity.proxIntelligence === "object" &&
            !Array.isArray(opportunity.proxIntelligence)
          ? opportunity.proxIntelligence as Record<string, unknown>
          : null;
        return Boolean(
          opportunity.decisionState === "qualified" &&
          opportunity.eligible === true &&
          opportunity.liveDataFresh === true &&
          packet?.fresh === true &&
          packet.state !== "stale" &&
          packet.state !== "weakening",
        );
      });
      const contractValid = Boolean(
        cryptoFrame.methodology_version === "crypto-momentum-v3-prox-authority" &&
        frame.version === "crypto-decision-frame-v1" &&
        frame.authority === "backend_atomic" &&
        expectedOpportunityCount === actualOpportunityCount,
      );
      const ok = cryptoFrame.complete === true &&
        frameFresh && contractValid && authorityValid;
      checks.push({
        name: "crypto_atomic_decision_frame",
        ok,
        message: !frameFresh
          ? "The latest crypto decision frame has expired."
          : !contractValid
            ? "The latest crypto decision frame does not match its atomic contract."
            : !authorityValid
              ? "A crypto hero or contender lacks fresh bounded ProX authority."
              : "Crypto is serving one fresh atomic backend decision with validated hero and contender authority.",
        detail: {
          decisionAt: cryptoFrame.decision_at,
          freshUntil: cryptoFrame.fresh_until,
          ageMinutes: Number.isFinite(decisionAgeMinutes)
            ? Number(decisionAgeMinutes.toFixed(1))
            : null,
          expectedOpportunityCount,
          actualOpportunityCount,
          heroSymbol: hero ? String(hero.symbol ?? "") : null,
          contenderCount: contenders.length,
          radarCount: radar.length,
          frameFresh,
          contractValid,
          authorityValid,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "crypto_atomic_decision_frame",
      ok: false,
      message: "Crypto decision frames are unavailable; run migration 0019 before deploying.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // The multi-venue lane is deliberately shadow-only. Health proves that the
  // broader source set is readable and that every proposed candidate is saved
  // exactly, without granting it authority over the public crypto ranking.
  try {
    const { data: discoveryRun, error: discoveryRunError } = await supabase
      .from("ht_crypto_discovery_runs")
      .select(
        "observed_at,observation_minute,expected_candidate_count,persisted_candidate_count,complete,observed_assets,source_diagnostics,outcomes_updated,outcomes_unavailable",
      )
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (discoveryRunError) throw discoveryRunError;

    if (!discoveryRun) {
      checks.push({
        name: "crypto_multivenue_shadow_discovery",
        ok: false,
        message: "Multi-venue crypto discovery has no completed shadow cycle yet.",
      });
    } else {
      const { data: discoveryObservations, error: discoveryObservationError } =
        await supabase
          .from("ht_crypto_discovery_observations")
          .select("asset_id,symbol,rank,discovery_packet")
          .eq("observation_minute", discoveryRun.observation_minute);
      if (discoveryObservationError) throw discoveryObservationError;
      const overdueCutoff = new Date(
        Date.now() - CRYPTO_OUTCOME_GRACE_MINUTES * 60_000,
      ).toISOString();
      const { count: overdueOutcomeCount, error: overdueOutcomeError } =
        await supabase
          .from("ht_crypto_discovery_observations")
          .select("*", { count: "exact", head: true })
          .is("price_15m_usd", null)
          .lte("target_15m_at", overdueCutoff)
          // Must match the same current-format filter as the outcome
          // backfill query in crypto/prox-sensor/route.ts, or this count
          // would permanently include the 49,583 legacy "crypto:SYMBOL"
          // rows that pipeline deliberately stopped chasing — they can
          // never resolve, so counting them here would just reintroduce
          // the same false failure at a different layer.
          .like("asset_id", "crypto:%:%");
      if (overdueOutcomeError) throw overdueOutcomeError;

      type DiscoveryCoverageRow = {
        assetId?: unknown;
        symbol?: unknown;
        rank?: unknown;
      };
      const normalizeDiscoveryRows = (rows: DiscoveryCoverageRow[]) =>
        rows.map((row) => ({
          assetId: String(row.assetId ?? "").trim(),
          symbol: String(row.symbol ?? "").trim().toUpperCase(),
          rank: Number(row.rank),
        })).sort((left, right) =>
          left.rank - right.rank || left.assetId.localeCompare(right.assetId)
        );
      const receiptRows = Array.isArray(discoveryRun.observed_assets)
        ? discoveryRun.observed_assets as DiscoveryCoverageRow[]
        : [];
      const actualRows = (discoveryObservations ?? []).map((row) => ({
        assetId: row.asset_id,
        symbol: row.symbol,
        rank: row.rank,
      }));
      const exactCandidateSet =
        JSON.stringify(normalizeDiscoveryRows(receiptRows)) ===
        JSON.stringify(normalizeDiscoveryRows(actualRows));
      const expectedCount = Number(discoveryRun.expected_candidate_count);
      const persistedCount = Number(discoveryRun.persisted_candidate_count);
      const actualCount = discoveryObservations?.length ?? 0;
      const diagnostics = discoveryRun.source_diagnostics &&
          typeof discoveryRun.source_diagnostics === "object" &&
          !Array.isArray(discoveryRun.source_diagnostics)
        ? discoveryRun.source_diagnostics as Record<string, unknown>
        : {};
      const configuredVenues = Number(diagnostics.configuredVenues);
      const healthyVenues = Number(diagnostics.healthyVenues);
      const supportedPairs = Number(diagnostics.supportedPairs);
      const observedAssets = Number(diagnostics.observedAssets);
      const candidateAssets = Number(diagnostics.candidateAssets);
      const providerFailures = Number(diagnostics.providerFailures);
      const attentionSourceHealthy = diagnostics.attentionSourceHealthy === true;
      const sourceCoverageHealthy =
        configuredVenues === 3 &&
        healthyVenues >= 2 &&
        supportedPairs > 0 &&
        observedAssets > 0;
      const packetCoverage = (discoveryObservations ?? []).every((row) => {
        const packet = row.discovery_packet &&
            typeof row.discovery_packet === "object"
          ? row.discovery_packet as { assetId?: unknown; rank?: unknown }
          : null;
        return Boolean(
          packet &&
          String(packet.assetId ?? "") === row.asset_id &&
          Number(packet.rank) === Number(row.rank),
        );
      });
      const complete =
        discoveryRun.complete === true &&
        expectedCount === persistedCount &&
        persistedCount === actualCount &&
        candidateAssets === expectedCount;
      const discoveryAgeHours = hoursSince(discoveryRun.observed_at);
      const fresh = discoveryAgeHours <= MAX_CRYPTO_PROX_AGE_HOURS;
      const outcomesCurrent = (overdueOutcomeCount ?? 0) === 0;

      checks.push({
        name: "crypto_multivenue_shadow_discovery",
        ok:
          complete &&
          sourceCoverageHealthy &&
          exactCandidateSet &&
          packetCoverage &&
          outcomesCurrent &&
          fresh,
        message: !complete
          ? "The latest multi-venue discovery receipt does not match its persisted candidate count."
          : !sourceCoverageHealthy
            ? "Multi-venue discovery did not receive enough healthy market coverage."
            : !exactCandidateSet
              ? "The persisted discovery candidates do not match the collection receipt."
              : !packetCoverage
                ? "One or more discovery candidates is missing its shadow decision packet."
                : !outcomesCurrent
                  ? "Multi-venue discovery has overdue 15-minute outcomes."
                  : !fresh
                    ? "Multi-venue crypto discovery is stale."
                    : "Multi-venue crypto discovery is fresh, shadow-only, exact-set verified, and recording outcomes.",
        detail: {
          authority: "none",
          observedAt: discoveryRun.observed_at,
          expectedCount,
          persistedCount,
          actualCount,
          configuredVenues,
          healthyVenues,
          supportedPairs,
          observedAssets,
          candidateAssets,
          providerFailures,
          attentionSourceHealthy,
          sourceCoverageHealthy,
          exactCandidateSet,
          packetCoverage,
          overdue15mOutcomes: overdueOutcomeCount ?? 0,
          outcomesUpdatedThisCycle: discoveryRun.outcomes_updated,
          outcomesUnavailableThisCycle: discoveryRun.outcomes_unavailable,
          ageMinutes: Number.isFinite(discoveryAgeHours)
            ? Number((discoveryAgeHours * 60).toFixed(1))
            : null,
          maxAgeMinutes: MAX_CRYPTO_PROX_AGE_HOURS * 60,
        },
      });
    }
  } catch (err: unknown) {
    checks.push({
      name: "crypto_multivenue_shadow_discovery",
      ok: false,
      message: "Multi-venue crypto discovery history is unavailable; run migration 0012 before deploying.",
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
