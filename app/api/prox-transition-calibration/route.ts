import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import { getProxEasternMarketClock } from "@/lib/prox/market-discovery";
import {
  PROX_TRANSITION_CALIBRATION_VERSION,
  PROX_TRANSITION_LEARNING_CASE_VERSION,
  buildProxTransitionCalibrations,
  buildProxTransitionProfile,
  classifyProxTransitionLearningOutcome,
  getProxTransitionCohortKeys,
  proxTransitionCalibrationFromStorage,
  proxTransitionProfileFromStorage,
  selectProxTransitionComparisonEvidence,
  type ProxTransitionLearningCase,
} from "@/lib/prox/transition-calibration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const PAGE_SIZE = 1000;
const BATCH_SIZE = 80;
const WRITE_BATCH_SIZE = 100;

type ObservationRow = {
  id: string;
  ledger_id: string;
  trading_date: string;
  ticker: string;
  observed_at: string;
  role: string;
  rank: number;
  price: number;
  score: number;
  source_run_id: string | null;
  engine_version: string | null;
  decision_snapshot: Record<string, unknown> | null;
};

type LedgerRow = {
  id: string;
  highest_price_after_signal: number;
  highest_price_at: string;
  lowest_price_after_signal: number;
  lowest_price_at: string;
  time_to_peak_minutes: number;
  finalized_at: string | null;
};

type TransitionRow = {
  id: string;
  before_crowd_observation_id: string;
  spot_first_at: string;
  spot_first_price: number;
  transition_minutes: number;
};

type LearningCaseRow = {
  id: string;
  ticker: string;
  trading_date: string;
  before_crowd_observation_id: string;
  before_crowd_ledger_id: string;
  first_seen_price: number;
  market_session: string;
  price_bucket: string;
  relative_volume_bucket: string;
  momentum_bucket: string;
  crowd_bucket: string;
  trap_bucket: string;
  score_bucket: string;
  graduated_to_spot: boolean;
  transition_minutes: number | null;
  max_gain_percent: number;
  max_drawdown_percent: number;
  time_to_peak_minutes: number;
  status: "active" | "complete" | "quarantined";
  calibratable: boolean;
  fingerprint?: Record<string, unknown> | null;
  [key: string]: unknown;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing server-side Supabase service credentials.");
  }
  return createClient(url, key);
}

function isAuthorized(request: Request) {
  return Boolean(
    CRON_SECRET &&
      request.headers.get("authorization") === `Bearer ${CRON_SECRET}`,
  );
}

function validTicker(value: string | null) {
  const ticker = value?.toUpperCase().trim() ?? "";
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function observationMinute(date: Date) {
  const minute = new Date(date);
  minute.setUTCSeconds(0, 0);
  return minute.toISOString();
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

async function readCurrentBeforeCrowdObservations(
  supabase: ReturnType<typeof getSupabase>,
  tradingDate: string,
) {
  const rows: ObservationRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ht_opportunity_observations")
      .select(
        "id,ledger_id,trading_date,ticker,observed_at,role,rank,price,score,source_run_id,engine_version,decision_snapshot",
      )
      .eq("trading_date", tradingDate)
      .eq("strategy", "before_the_crowd")
      .order("observed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as ObservationRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const firstByTicker = new Map<string, ObservationRow>();
  for (const row of rows) {
    const ticker = row.ticker.toUpperCase().trim();
    if (ticker && !firstByTicker.has(ticker)) firstByTicker.set(ticker, row);
  }
  return [...firstByTicker.values()];
}

async function readLedgers(
  supabase: ReturnType<typeof getSupabase>,
  ledgerIds: string[],
) {
  const map = new Map<string, LedgerRow>();
  for (let index = 0; index < ledgerIds.length; index += BATCH_SIZE) {
    const { data, error } = await supabase
      .from("ht_opportunity_ledger")
      .select(
        "id,highest_price_after_signal,highest_price_at,lowest_price_after_signal,lowest_price_at,time_to_peak_minutes,finalized_at",
      )
      .in("id", ledgerIds.slice(index, index + BATCH_SIZE));
    if (error) throw error;
    for (const row of (data ?? []) as LedgerRow[]) map.set(row.id, row);
  }
  return map;
}

async function readTransitions(
  supabase: ReturnType<typeof getSupabase>,
  observationIds: string[],
) {
  const map = new Map<string, TransitionRow>();
  for (let index = 0; index < observationIds.length; index += BATCH_SIZE) {
    const { data, error } = await supabase
      .from("prox_strategy_transition_cases")
      .select(
        "id,before_crowd_observation_id,spot_first_at,spot_first_price,transition_minutes",
      )
      .in(
        "before_crowd_observation_id",
        observationIds.slice(index, index + BATCH_SIZE),
      );
    if (error) throw error;
    for (const row of (data ?? []) as TransitionRow[]) {
      map.set(row.before_crowd_observation_id, row);
    }
  }
  return map;
}

function buildLearningOutcome(input: {
  firstPrice: number;
  ledger: LedgerRow;
  additionalObservedPrice?: number | null;
  additionalObservedAt?: string | null;
}) {
  const ledgerHigh = finiteNumber(input.ledger.highest_price_after_signal);
  const highestPrice = Math.max(
    ledgerHigh,
    input.firstPrice,
    input.additionalObservedPrice ?? 0,
  );
  const lowestPrice = Math.min(
    finiteNumber(input.ledger.lowest_price_after_signal, input.firstPrice),
    input.firstPrice,
  );
  const maxGainPercent =
    ((highestPrice - input.firstPrice) / input.firstPrice) * 100;
  const maxDrawdownPercent =
    ((lowestPrice - input.firstPrice) / input.firstPrice) * 100;
  return {
    highestPrice,
    highestAt:
      input.additionalObservedPrice !== null &&
      input.additionalObservedPrice !== undefined &&
      input.additionalObservedPrice > ledgerHigh &&
      input.additionalObservedAt
        ? input.additionalObservedAt
        : input.ledger.highest_price_at,
    lowestPrice,
    lowestAt: input.ledger.lowest_price_at,
    maxGainPercent: Number(maxGainPercent.toFixed(3)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(3)),
    outcomeLabel: classifyProxTransitionLearningOutcome({
      maxGainPercent,
      maxDrawdownPercent,
    }),
  };
}

async function materializeCurrentLearningCases(input: {
  supabase: ReturnType<typeof getSupabase>;
  tradingDate: string;
  observedAt: string;
}) {
  const observations = await readCurrentBeforeCrowdObservations(
    input.supabase,
    input.tradingDate,
  );
  const [ledgers, transitions] = await Promise.all([
    readLedgers(
      input.supabase,
      observations.map((row) => row.ledger_id),
    ),
    readTransitions(
      input.supabase,
      observations.map((row) => row.id),
    ),
  ]);
  const rows: Array<Record<string, unknown>> = [];
  for (const observation of observations) {
    const ledger = ledgers.get(observation.ledger_id);
    if (!ledger || observation.price <= 0) continue;
    const transition = transitions.get(observation.id) ?? null;
    const profile = buildProxTransitionProfile({
      marketSession: observation.decision_snapshot?.scanSession,
      price: observation.price,
      relativeVolume: observation.decision_snapshot?.relativeVolume,
      momentumScore: observation.decision_snapshot?.momentumScore,
      crowdScore: observation.decision_snapshot?.crowdScore,
      trapScore: observation.decision_snapshot?.trapScore,
      opportunityScore: observation.score,
    });
    const outcome = buildLearningOutcome({
      firstPrice: observation.price,
      ledger,
      additionalObservedPrice: transition?.spot_first_price ?? null,
      additionalObservedAt: transition?.spot_first_at ?? null,
    });
    const complete = ledger.finalized_at !== null;
    rows.push({
      ticker: observation.ticker,
      trading_date: input.tradingDate,
      methodology_version: PROX_TRANSITION_LEARNING_CASE_VERSION,
      before_crowd_observation_id: observation.id,
      before_crowd_ledger_id: observation.ledger_id,
      transition_case_id: transition?.id ?? null,
      first_seen_at: observation.observed_at,
      first_seen_price: observation.price,
      first_role: observation.role,
      first_rank: observation.rank,
      first_score: observation.score,
      first_source_run_id: observation.source_run_id,
      first_engine_version: observation.engine_version,
      first_decision_snapshot: observation.decision_snapshot ?? {},
      market_session: profile.marketSession,
      entry_relative_volume: nullableFiniteNumber(
        observation.decision_snapshot?.relativeVolume,
      ),
      entry_momentum_score: nullableFiniteNumber(
        observation.decision_snapshot?.momentumScore,
      ),
      entry_crowd_score: nullableFiniteNumber(
        observation.decision_snapshot?.crowdScore,
      ),
      entry_trap_score: nullableFiniteNumber(
        observation.decision_snapshot?.trapScore,
      ),
      price_bucket: profile.priceBucket,
      relative_volume_bucket: profile.relativeVolumeBucket,
      momentum_bucket: profile.momentumBucket,
      crowd_bucket: profile.crowdBucket,
      trap_bucket: profile.trapBucket,
      score_bucket: profile.scoreBucket,
      graduated_to_spot: transition !== null,
      spot_first_at: transition?.spot_first_at ?? null,
      spot_first_price: transition?.spot_first_price ?? null,
      transition_minutes: transition?.transition_minutes ?? null,
      highest_price_after_early: outcome.highestPrice,
      highest_price_at: outcome.highestAt,
      lowest_price_after_early: outcome.lowestPrice,
      lowest_price_at: outcome.lowestAt,
      max_gain_percent: outcome.maxGainPercent,
      max_drawdown_percent: outcome.maxDrawdownPercent,
      time_to_peak_minutes: Math.max(
        0,
        finiteNumber(ledger.time_to_peak_minutes),
      ),
      outcome_label: outcome.outcomeLabel,
      missed_explosion:
        transition === null && outcome.maxGainPercent >= 100,
      status: complete ? "complete" : "active",
      calibratable: complete,
      fingerprint: {
        sourceKind: "canonical_before_crowd_learning_case",
        ticker: observation.ticker,
        tradingDate: input.tradingDate,
        profile,
        graduatedToSpot: transition !== null,
        outcome: {
          maxGainPercent: outcome.maxGainPercent,
          maxDrawdownPercent: outcome.maxDrawdownPercent,
          timeToPeakMinutes: ledger.time_to_peak_minutes,
          label: outcome.outcomeLabel,
        },
        predictionAuthority: false,
        publicScoreAuthority: false,
        executionAuthority: false,
      },
      finalized_at: ledger.finalized_at,
      updated_at: input.observedAt,
    });
  }
  await writeInBatches(rows, async (batch) => {
    const { error } = await input.supabase
      .from("prox_strategy_learning_cases")
      .upsert(batch, {
        onConflict: "ticker,trading_date,methodology_version",
      });
    return { error };
  });
  return rows.length;
}

async function refreshActiveLearningCases(
  supabase: ReturnType<typeof getSupabase>,
  observedAt: string,
) {
  const { data, error } = await supabase
    .from("prox_strategy_learning_cases")
    .select("*")
    .eq("methodology_version", PROX_TRANSITION_LEARNING_CASE_VERSION)
    .eq("status", "active")
    .limit(5000);
  if (error) throw error;
  const active = (data ?? []) as LearningCaseRow[];
  const [ledgers, transitions] = await Promise.all([
    readLedgers(
      supabase,
      active.map((row) => row.before_crowd_ledger_id),
    ),
    readTransitions(
      supabase,
      active.map((row) => row.before_crowd_observation_id),
    ),
  ]);
  const updates: Array<Record<string, unknown>> = [];
  for (const item of active) {
    const ledger = ledgers.get(item.before_crowd_ledger_id);
    if (!ledger || item.first_seen_price <= 0) continue;
    const transition = transitions.get(item.before_crowd_observation_id) ?? null;
    const outcome = buildLearningOutcome({
      firstPrice: item.first_seen_price,
      ledger,
      additionalObservedPrice: transition?.spot_first_price ?? null,
      additionalObservedAt: transition?.spot_first_at ?? null,
    });
    const complete = ledger.finalized_at !== null;
    updates.push({
      ...item,
      transition_case_id: transition?.id ?? null,
      graduated_to_spot: transition !== null,
      spot_first_at: transition?.spot_first_at ?? null,
      spot_first_price: transition?.spot_first_price ?? null,
      transition_minutes: transition?.transition_minutes ?? null,
      highest_price_after_early: outcome.highestPrice,
      highest_price_at: outcome.highestAt,
      lowest_price_after_early: outcome.lowestPrice,
      lowest_price_at: outcome.lowestAt,
      max_gain_percent: outcome.maxGainPercent,
      max_drawdown_percent: outcome.maxDrawdownPercent,
      time_to_peak_minutes: Math.max(
        0,
        finiteNumber(ledger.time_to_peak_minutes),
      ),
      outcome_label: outcome.outcomeLabel,
      missed_explosion:
        transition === null && outcome.maxGainPercent >= 100,
      status: complete ? "complete" : "active",
      calibratable: complete,
      fingerprint: {
        ...(item.fingerprint ?? {}),
        graduatedToSpot: transition !== null,
        outcome: {
          maxGainPercent: outcome.maxGainPercent,
          maxDrawdownPercent: outcome.maxDrawdownPercent,
          timeToPeakMinutes: ledger.time_to_peak_minutes,
          label: outcome.outcomeLabel,
        },
      },
      finalized_at: ledger.finalized_at,
      updated_at: observedAt,
    });
  }
  await writeInBatches(updates, async (batch) => {
    const { error: updateError } = await supabase
      .from("prox_strategy_learning_cases")
      .upsert(batch, { onConflict: "id" });
    return { error: updateError };
  });
  return updates.length;
}

async function readMatureLearningCases(
  supabase: ReturnType<typeof getSupabase>,
) {
  const rows: LearningCaseRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("prox_strategy_learning_cases")
      .select(
        "id,ticker,trading_date,before_crowd_observation_id,before_crowd_ledger_id,first_seen_price,market_session,price_bucket,relative_volume_bucket,momentum_bucket,crowd_bucket,trap_bucket,score_bucket,graduated_to_spot,transition_minutes,max_gain_percent,max_drawdown_percent,time_to_peak_minutes,status,calibratable",
      )
      .eq("methodology_version", PROX_TRANSITION_LEARNING_CASE_VERSION)
      .eq("status", "complete")
      .eq("calibratable", true)
      .order("trading_date", { ascending: true })
      .order("ticker", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as LearningCaseRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function toLearningInput(row: LearningCaseRow): ProxTransitionLearningCase {
  return {
    profile: proxTransitionProfileFromStorage(row),
    graduatedToSpot: row.graduated_to_spot,
    transitionMinutes:
      row.transition_minutes === null
        ? null
        : finiteNumber(row.transition_minutes),
    maxGainPercent: finiteNumber(row.max_gain_percent),
    maxDrawdownPercent: finiteNumber(row.max_drawdown_percent),
    timeToPeakMinutes: Math.max(
      0,
      finiteNumber(row.time_to_peak_minutes),
    ),
  };
}

async function inspectTicker(
  supabase: ReturnType<typeof getSupabase>,
  ticker: string,
) {
  const { data: learningCase, error } = await supabase
    .from("prox_strategy_learning_cases")
    .select("*")
    .eq("ticker", ticker)
    .eq("methodology_version", PROX_TRANSITION_LEARNING_CASE_VERSION)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!learningCase) return { learningCase: null, evidence: null };
  const profile = proxTransitionProfileFromStorage(learningCase);
  const keys = getProxTransitionCohortKeys(profile);
  const { data: rows, error: calibrationError } = await supabase
    .from("prox_transition_pattern_calibrations")
    .select("*")
    .in("cohort_key", keys);
  if (calibrationError) throw calibrationError;
  const evidence = selectProxTransitionComparisonEvidence(
    profile,
    ((rows ?? []) as Array<Record<string, unknown>>).map(
      proxTransitionCalibrationFromStorage,
    ),
  );
  return {
    learningCase: {
      ticker,
      tradingDate: learningCase.trading_date,
      firstSeenAt: learningCase.first_seen_at,
      firstSeenPrice: Number(learningCase.first_seen_price),
      graduatedToSpot: learningCase.graduated_to_spot,
      status: learningCase.status,
      profile,
    },
    evidence,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTicker = url.searchParams.get("ticker");
  const ticker = validTicker(requestedTicker);
  if (requestedTicker && !ticker) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }
  const supabase = getSupabase();
  if (ticker) {
    try {
      const result = await inspectTicker(supabase, ticker);
      return NextResponse.json({
        ticker,
        ...result,
        calibrationVersion: PROX_TRANSITION_CALIBRATION_VERSION,
        authority: "shadow_research_only",
        publicScoreAuthority: false,
        executionAuthority: false,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      return NextResponse.json(
        {
          error: getErrorMessage(
            error,
            "Pro X transition evidence is unavailable; run migration 0016.",
          ),
        },
        { status: 500 },
      );
    }
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const observedAt = now.toISOString();
  const minute = observationMinute(now);
  const tradingDate = getProxEasternMarketClock(now).easternDate;
  let runId: string | null = null;
  try {
    const { data: run, error: runError } = await supabase
      .from("prox_transition_calibration_runs")
      .insert({
        observed_at: observedAt,
        observation_minute: minute,
        trading_date: tradingDate,
        methodology_version: PROX_TRANSITION_CALIBRATION_VERSION,
        diagnostics: {
          authority: "shadow_research_only",
          noPublicScore: true,
          noExecutionAuthority: true,
        },
      })
      .select("id")
      .single();
    if (runError || !run?.id) {
      if (runError?.code === "23505") {
        const { data: existing } = await supabase
          .from("prox_transition_calibration_runs")
          .select("id,complete,completed_at,error_message")
          .eq("observation_minute", minute)
          .eq(
            "methodology_version",
            PROX_TRANSITION_CALIBRATION_VERSION,
          )
          .maybeSingle();
        return NextResponse.json({
          success: existing?.complete === true,
          deduplicated: true,
          run: existing ?? null,
          authority: "shadow_research_only",
          timestamp: new Date().toISOString(),
        });
      }
      throw runError ?? new Error("Calibration run receipt was not created.");
    }
    runId = String(run.id);

    const materializedCurrentCases = await materializeCurrentLearningCases({
      supabase,
      tradingDate,
      observedAt,
    });
    const refreshedActiveCases = await refreshActiveLearningCases(
      supabase,
      observedAt,
    );
    const matureRows = await readMatureLearningCases(supabase);
    const calibrations = buildProxTransitionCalibrations(
      matureRows.map(toLearningInput),
    );
    const calibrationRows = calibrations.map((calibration) => ({
      cohort_key: calibration.cohortKey,
      methodology_version: PROX_TRANSITION_CALIBRATION_VERSION,
      cohort_level: calibration.cohortLevel,
      dimensions: calibration.dimensions,
      sample_size: calibration.sampleSize,
      graduated_count: calibration.graduatedCount,
      graduation_rate: calibration.graduationRate,
      explosion_count: calibration.explosionCount,
      explosion_rate: calibration.explosionRate,
      continuation_count: calibration.continuationCount,
      continuation_rate: calibration.continuationRate,
      failure_count: calibration.failureCount,
      failure_rate: calibration.failureRate,
      missed_explosion_count: calibration.missedExplosionCount,
      missed_explosion_rate: calibration.missedExplosionRate,
      median_max_gain_percent: calibration.medianMaxGainPercent,
      median_max_drawdown_percent: calibration.medianMaxDrawdownPercent,
      median_time_to_peak_minutes: calibration.medianTimeToPeakMinutes,
      median_transition_minutes: calibration.medianTransitionMinutes,
      evidence_state: calibration.evidenceState,
      authority: "shadow_research_only",
      computed_at: observedAt,
      updated_at: observedAt,
    }));
    await writeInBatches(calibrationRows, async (batch) => {
      const { error } = await supabase
        .from("prox_transition_pattern_calibrations")
        .upsert(batch, { onConflict: "cohort_key" });
      return { error };
    });
    const { count: sourceCaseCount, error: sourceCountError } = await supabase
      .from("prox_strategy_learning_cases")
      .select("*", { count: "exact", head: true })
      .eq("methodology_version", PROX_TRANSITION_LEARNING_CASE_VERSION);
    if (sourceCountError) throw sourceCountError;
    const { count: persistedCohortCount, error: cohortCountError } =
      await supabase
        .from("prox_transition_pattern_calibrations")
        .select("*", { count: "exact", head: true })
        .eq("methodology_version", PROX_TRANSITION_CALIBRATION_VERSION);
    if (cohortCountError) throw cohortCountError;
    const expectedCohortCount = calibrations.length;
    const actualCohortCount = persistedCohortCount ?? 0;
    const complete = expectedCohortCount === actualCohortCount;
    const completedAt = new Date().toISOString();
    const diagnostics = {
      authority: "shadow_research_only",
      materializedCurrentCases,
      refreshedActiveCases,
      noPublicScore: true,
      noExecutionAuthority: true,
      denominator: "all_finalized_before_the_crowd_cases",
    };
    const { error: completionError } = await supabase
      .from("prox_transition_calibration_runs")
      .update({
        source_case_count: sourceCaseCount ?? 0,
        mature_case_count: matureRows.length,
        expected_cohort_count: expectedCohortCount,
        persisted_cohort_count: actualCohortCount,
        emerging_cohort_count: calibrations.filter(
          (item) => item.evidenceState === "emerging",
        ).length,
        calibrated_cohort_count: calibrations.filter(
          (item) => item.evidenceState === "calibrated",
        ).length,
        complete,
        diagnostics,
        error_message: complete ? null : "Calibration coverage mismatch.",
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", runId);
    if (completionError) throw completionError;
    return NextResponse.json({
      success: complete,
      calibrationVersion: PROX_TRANSITION_CALIBRATION_VERSION,
      authority: "shadow_research_only",
      diagnostics: {
        ...diagnostics,
        sourceCaseCount: sourceCaseCount ?? 0,
        matureCaseCount: matureRows.length,
        expectedCohortCount,
        persistedCohortCount: actualCohortCount,
        emergingCohortCount: calibrations.filter(
          (item) => item.evidenceState === "emerging",
        ).length,
        calibratedCohortCount: calibrations.filter(
          (item) => item.evidenceState === "calibrated",
        ).length,
      },
      timestamp: completedAt,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(
      error,
      "Pro X transition calibration failed; run migration 0016.",
    );
    if (runId) {
      await supabase
        .from("prox_transition_calibration_runs")
        .update({
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
