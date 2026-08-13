import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import {
  resolveSnapshotPrice,
  resolveSnapshotTimestampMs,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import { getProxEasternMarketClock } from "@/lib/prox/market-discovery";
import {
  PROX_CALIBRATION_VERSION,
  PROX_OUTCOME_MEMORY_VERSION,
  buildProxPatternCalibrations,
  computeProxReturnPercent,
  getProxEpisodeHorizonTargets,
  labelProxOutcome,
  type ProxCalibrationEpisode,
  type ProxOutcomeHorizon,
  type ProxOutcomeLabel,
} from "@/lib/prox/outcome-memory";
import {
  PROX_TRANSITION_MEMORY_VERSION,
  buildProxCanonicalTransitionCase,
} from "@/lib/prox/transition-memory";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SNAPSHOT_ENDPOINT =
  "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers";
const ACTIVE_EPISODE_LIMIT = 400;
const WRITE_BATCH_SIZE = 100;
const READ_TICKER_BATCH_SIZE = 80;
const OBSERVATION_PAGE_SIZE = 1000;

type EpisodeRow = {
  id: string;
  ticker: string;
  trading_date: string;
  started_at: string;
  market_session: "pre_market" | "regular" | "after_hours" | "closed";
  entry_price: number;
  latest_price: number;
  latest_observed_at: string;
  sampled_high_price: number;
  sampled_high_at: string;
  sampled_low_price: number;
  sampled_low_at: string;
  max_gain_percent: number;
  max_drawdown_percent: number;
  time_to_peak_minutes: number | null;
  initial_anomaly_flags: unknown;
  pattern_signature: string;
  status: "active" | "complete" | "quarantined";
  outcome_label: ProxOutcomeLabel;
  [key: string]: unknown;
};

type OutcomeRow = {
  id?: string;
  episode_id: string;
  horizon: ProxOutcomeHorizon;
  target_at: string;
  measured_at: string | null;
  measured_price: number | null;
  return_percent: number | null;
  complete: boolean;
  [key: string]: unknown;
};

type CanonicalObservationRow = {
  id: string;
  ledger_id: string;
  trading_date: string;
  ticker: string;
  strategy: "spot_momentum" | "before_the_crowd";
  observed_at: string;
  role: string;
  rank: number;
  price: number;
  score: number;
  source_run_id: string | null;
  engine_version: string | null;
  decision_snapshot: Record<string, unknown> | null;
};

type CanonicalLedgerRow = {
  id: string;
  highest_price_after_signal: number;
  highest_price_at: string;
  lowest_price_after_signal: number;
  lowest_price_at: string;
  finalized_at: string | null;
};

type TransitionMemoryResult = {
  available: boolean;
  sourcePairCount: number;
  persistedCaseCount: number;
  caseTickers: string[];
  unavailableReason: string | null;
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

function normalizeFlags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((flag): flag is string => typeof flag === "string");
}

async function fetchPolygonSnapshot() {
  const response = await fetch(
    `${SNAPSHOT_ENDPOINT}?include_otc=false&apiKey=${POLYGON_KEY}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Polygon outcome snapshot failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    tickers?: PolygonSnapshotRow[];
  };
  const rows = Array.isArray(payload.tickers) ? payload.tickers : [];
  if (rows.length === 0) {
    throw new Error("Polygon returned an empty outcome snapshot.");
  }
  return rows;
}

function snapshotPriceMap(rows: PolygonSnapshotRow[]) {
  const map = new Map<
    string,
    { price: number; sourceTimestampMs: number | null }
  >();
  for (const row of rows) {
    const ticker = String(row.ticker ?? "").toUpperCase().trim();
    const price = resolveSnapshotPrice(row);
    if (ticker && price > 0) {
      map.set(ticker, {
        price,
        sourceTimestampMs: resolveSnapshotTimestampMs(row),
      });
    }
  }
  return map;
}

async function writeInBatches(
  rows: Array<Record<string, unknown>>,
  writer: (batch: Array<Record<string, unknown>>) => Promise<{ error: { message: string } | null }>,
) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    const result = await writer(rows.slice(index, index + WRITE_BATCH_SIZE));
    if (result.error) throw new Error(result.error.message);
  }
}

async function ensureEpisodeHorizons(
  supabase: ReturnType<typeof getSupabase>,
  episodes: EpisodeRow[],
) {
  const rows = episodes.flatMap((episode) =>
    getProxEpisodeHorizonTargets({
      startedAt: episode.started_at,
      tradingDate: episode.trading_date,
      marketSession: episode.market_session,
    }).map((target) => ({
      episode_id: episode.id,
      horizon: target.horizon,
      target_at: target.targetAt,
      complete: false,
      methodology_version: PROX_OUTCOME_MEMORY_VERSION,
    })),
  );
  await writeInBatches(rows, async (batch) => {
    const { error } = await supabase
      .from("prox_research_episode_outcomes")
      .upsert(batch, {
        onConflict: "episode_id,horizon",
        ignoreDuplicates: true,
      });
    return { error };
  });
}

async function readEpisodeOutcomes(
  supabase: ReturnType<typeof getSupabase>,
  episodeIds: string[],
) {
  const rows: OutcomeRow[] = [];
  for (
    let index = 0;
    index < episodeIds.length;
    index += READ_TICKER_BATCH_SIZE
  ) {
    const { data, error } = await supabase
      .from("prox_research_episode_outcomes")
      .select("*")
      .in("episode_id", episodeIds.slice(index, index + READ_TICKER_BATCH_SIZE));
    if (error) throw error;
    rows.push(...((data ?? []) as OutcomeRow[]));
  }
  return rows;
}

async function readInterveningCorporateActions(
  supabase: ReturnType<typeof getSupabase>,
  episodes: EpisodeRow[],
  currentEasternDate: string,
) {
  const affected = new Set<string>();
  const tickers = [...new Set(episodes.map((episode) => episode.ticker))];
  for (
    let index = 0;
    index < tickers.length;
    index += READ_TICKER_BATCH_SIZE
  ) {
    const { data, error } = await supabase
      .from("prox_corporate_actions")
      .select("ticker,execution_date")
      .in("ticker", tickers.slice(index, index + READ_TICKER_BATCH_SIZE))
      .lte("execution_date", currentEasternDate)
      .order("execution_date", { ascending: false });
    if (error) throw error;
    for (const action of data ?? []) {
      const ticker = String(action.ticker ?? "").toUpperCase().trim();
      const executionDate = String(action.execution_date ?? "");
      for (const episode of episodes) {
        if (
          episode.ticker === ticker &&
          executionDate > episode.trading_date
        ) {
          affected.add(episode.id);
        }
      }
    }
  }
  return affected;
}

async function writeCalibrations(
  supabase: ReturnType<typeof getSupabase>,
  computedAt: string,
) {
  const { data, error } = await supabase
    .from("prox_research_episodes")
    .select(
      "pattern_signature,market_session,outcome_label,max_gain_percent,max_drawdown_percent,time_to_peak_minutes",
    )
    .eq("methodology_version", PROX_OUTCOME_MEMORY_VERSION)
    .eq("status", "complete")
    .eq("calibratable", true)
    .order("completed_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const inputs: ProxCalibrationEpisode[] = (data ?? []).map((episode) => ({
    patternSignature: String(episode.pattern_signature ?? "unclassified"),
    marketSession: episode.market_session as ProxCalibrationEpisode["marketSession"],
    label: episode.outcome_label as ProxOutcomeLabel,
    maxGainPercent: finiteNumber(episode.max_gain_percent),
    maxDrawdownPercent: finiteNumber(episode.max_drawdown_percent),
    timeToPeakMinutes:
      episode.time_to_peak_minutes === null
        ? null
        : finiteNumber(episode.time_to_peak_minutes),
  }));
  const calibrations = buildProxPatternCalibrations(inputs);
  const rows = calibrations.map((calibration) => ({
    calibration_key: calibration.calibrationKey,
    methodology_version: PROX_CALIBRATION_VERSION,
    pattern_signature: calibration.patternSignature,
    market_session: calibration.marketSession,
    sample_size: calibration.sampleSize,
    continuation_count: calibration.continuationCount,
    failure_count: calibration.failureCount,
    inconclusive_count: calibration.inconclusiveCount,
    continuation_rate: calibration.continuationRate,
    average_max_gain_percent: calibration.averageMaxGainPercent,
    average_max_drawdown_percent: calibration.averageMaxDrawdownPercent,
    average_time_to_peak_minutes: calibration.averageTimeToPeakMinutes,
    evidence_state: calibration.evidenceState,
    stats: {
      authority: "shadow_research_only",
      minimumEmergingSample: 30,
      minimumCalibratedSample: 100,
    },
    computed_at: computedAt,
    updated_at: computedAt,
  }));
  await writeInBatches(rows, async (batch) => {
    const { error: writeError } = await supabase
      .from("prox_pattern_calibrations")
      .upsert(batch, { onConflict: "calibration_key" });
    return { error: writeError };
  });
  return rows.length;
}

async function readCanonicalObservations(
  supabase: ReturnType<typeof getSupabase>,
  tradingDate: string,
) {
  const rows: CanonicalObservationRow[] = [];
  for (let start = 0; ; start += OBSERVATION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ht_opportunity_observations")
      .select(
        "id,ledger_id,trading_date,ticker,strategy,observed_at,role,rank,price,score,source_run_id,engine_version,decision_snapshot",
      )
      .eq("trading_date", tradingDate)
      .in("strategy", ["before_the_crowd", "spot_momentum"])
      .order("observed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + OBSERVATION_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as CanonicalObservationRow[];
    rows.push(...page);
    if (page.length < OBSERVATION_PAGE_SIZE) break;
  }
  return rows;
}

async function readCanonicalLedgers(
  supabase: ReturnType<typeof getSupabase>,
  ledgerIds: string[],
) {
  const map = new Map<string, CanonicalLedgerRow>();
  for (
    let index = 0;
    index < ledgerIds.length;
    index += READ_TICKER_BATCH_SIZE
  ) {
    const { data, error } = await supabase
      .from("ht_opportunity_ledger")
      .select(
        "id,highest_price_after_signal,highest_price_at,lowest_price_after_signal,lowest_price_at,finalized_at",
      )
      .in("id", ledgerIds.slice(index, index + READ_TICKER_BATCH_SIZE));
    if (error) throw error;
    for (const row of (data ?? []) as CanonicalLedgerRow[]) {
      map.set(row.id, row);
    }
  }
  return map;
}

async function materializeCanonicalTransitionCases(input: {
  supabase: ReturnType<typeof getSupabase>;
  tradingDate: string;
  observedAt: string;
  minute: string;
}): Promise<TransitionMemoryResult> {
  try {
    const observations = await readCanonicalObservations(
      input.supabase,
      input.tradingDate,
    );
    const beforeCrowdFirst = new Map<string, CanonicalObservationRow>();
    const spotFirst = new Map<string, CanonicalObservationRow>();
    for (const observation of observations) {
      const ticker = observation.ticker.toUpperCase().trim();
      if (!ticker) continue;
      const target =
        observation.strategy === "before_the_crowd"
          ? beforeCrowdFirst
          : spotFirst;
      if (!target.has(ticker)) target.set(ticker, observation);
    }

    const pairs = [...beforeCrowdFirst.entries()].flatMap(
      ([ticker, beforeCrowd]) => {
        const spotMomentum = spotFirst.get(ticker);
        if (
          !spotMomentum ||
          new Date(spotMomentum.observed_at).getTime() <=
            new Date(beforeCrowd.observed_at).getTime()
        ) {
          return [];
        }
        return [{ ticker, beforeCrowd, spotMomentum }];
      },
    );
    const ledgers = await readCanonicalLedgers(
      input.supabase,
      pairs.map((pair) => pair.beforeCrowd.ledger_id),
    );
    const caseRows: Array<Record<string, unknown>> = [];
    for (const pair of pairs) {
      const ledger = ledgers.get(pair.beforeCrowd.ledger_id);
      if (!ledger) continue;
      const highestPrice = Math.max(
        finiteNumber(ledger.highest_price_after_signal),
        finiteNumber(pair.beforeCrowd.price),
        finiteNumber(pair.spotMomentum.price),
      );
      const highestAt =
        highestPrice > finiteNumber(ledger.highest_price_after_signal)
          ? pair.spotMomentum.observed_at
          : ledger.highest_price_at;
      const lowestPrice = Math.min(
        finiteNumber(ledger.lowest_price_after_signal),
        finiteNumber(pair.beforeCrowd.price),
      );
      const lowestAt =
        lowestPrice < finiteNumber(ledger.lowest_price_after_signal)
          ? pair.beforeCrowd.observed_at
          : ledger.lowest_price_at;
      const computed = buildProxCanonicalTransitionCase({
        ticker: pair.ticker,
        tradingDate: input.tradingDate,
        beforeCrowd: {
          observedAt: pair.beforeCrowd.observed_at,
          price: pair.beforeCrowd.price,
          role: pair.beforeCrowd.role,
          rank: pair.beforeCrowd.rank,
          score: pair.beforeCrowd.score,
          decisionSnapshot: pair.beforeCrowd.decision_snapshot,
        },
        spotMomentum: {
          observedAt: pair.spotMomentum.observed_at,
          price: pair.spotMomentum.price,
          role: pair.spotMomentum.role,
          rank: pair.spotMomentum.rank,
          score: pair.spotMomentum.score,
          decisionSnapshot: pair.spotMomentum.decision_snapshot,
        },
        outcome: {
          highestPrice,
          highestAt,
          lowestPrice,
          lowestAt,
        },
      });
      if (!computed) continue;
      const sessionOpenPrice =
        positiveNumber(
          pair.beforeCrowd.decision_snapshot?.sessionOpenPrice,
        ) ??
        positiveNumber(
          pair.spotMomentum.decision_snapshot?.sessionOpenPrice,
        );
      const timeFromEarlyToPeakMinutes = Math.max(
        0,
        (new Date(highestAt).getTime() -
          new Date(pair.beforeCrowd.observed_at).getTime()) /
          60_000,
      );
      caseRows.push({
        ticker: pair.ticker,
        trading_date: input.tradingDate,
        methodology_version: PROX_TRANSITION_MEMORY_VERSION,
        source_kind: "canonical_transition_case",
        before_crowd_observation_id: pair.beforeCrowd.id,
        before_crowd_ledger_id: pair.beforeCrowd.ledger_id,
        before_crowd_first_at: pair.beforeCrowd.observed_at,
        before_crowd_first_price: pair.beforeCrowd.price,
        before_crowd_first_role: pair.beforeCrowd.role,
        before_crowd_first_rank: pair.beforeCrowd.rank,
        before_crowd_first_score: pair.beforeCrowd.score,
        before_crowd_source_run_id: pair.beforeCrowd.source_run_id,
        before_crowd_engine_version: pair.beforeCrowd.engine_version,
        before_crowd_decision_snapshot:
          pair.beforeCrowd.decision_snapshot ?? {},
        spot_observation_id: pair.spotMomentum.id,
        spot_ledger_id: pair.spotMomentum.ledger_id,
        spot_first_at: pair.spotMomentum.observed_at,
        spot_first_price: pair.spotMomentum.price,
        spot_first_role: pair.spotMomentum.role,
        spot_first_rank: pair.spotMomentum.rank,
        spot_first_score: pair.spotMomentum.score,
        spot_source_run_id: pair.spotMomentum.source_run_id,
        spot_engine_version: pair.spotMomentum.engine_version,
        spot_decision_snapshot:
          pair.spotMomentum.decision_snapshot ?? {},
        transition_minutes: computed.transitionMinutes,
        transition_return_percent: computed.transitionReturnPercent,
        session_open_price: sessionOpenPrice,
        highest_price_after_early: highestPrice,
        highest_price_at: highestAt,
        lowest_price_after_early: lowestPrice,
        lowest_price_at: lowestAt,
        max_gain_from_early_percent: computed.maxGainFromEarlyPercent,
        max_drawdown_from_early_percent:
          computed.maxDrawdownFromEarlyPercent,
        max_gain_from_spot_percent: computed.maxGainFromSpotPercent,
        time_from_early_to_peak_minutes: Number(
          timeFromEarlyToPeakMinutes.toFixed(1),
        ),
        case_label: computed.caseLabel,
        status: ledger.finalized_at ? "complete" : "active",
        calibratable: false,
        case_fingerprint: computed.caseFingerprint,
        source_provenance: {
          authority: "canonical_history_only",
          beforeCrowdObservationId: pair.beforeCrowd.id,
          spotObservationId: pair.spotMomentum.id,
          beforeCrowdSourceRunId: pair.beforeCrowd.source_run_id,
          spotSourceRunId: pair.spotMomentum.source_run_id,
          beforeCrowdEngineVersion: pair.beforeCrowd.engine_version,
          spotEngineVersion: pair.spotMomentum.engine_version,
        },
        finalized_at: ledger.finalized_at,
        updated_at: input.observedAt,
      });
    }

    await writeInBatches(caseRows, async (batch) => {
      const { error } = await input.supabase
        .from("prox_strategy_transition_cases")
        .upsert(batch, {
          onConflict: "ticker,trading_date,methodology_version",
        });
      return { error };
    });
    const { count, error: countError } = await input.supabase
      .from("prox_strategy_transition_cases")
      .select("*", { count: "exact", head: true })
      .eq("trading_date", input.tradingDate)
      .eq("methodology_version", PROX_TRANSITION_MEMORY_VERSION);
    if (countError) throw countError;
    const persistedCaseCount = count ?? 0;
    const caseTickers = caseRows.map((row) => String(row.ticker));
    const complete = persistedCaseCount === pairs.length;
    const { error: runError } = await input.supabase
      .from("prox_strategy_transition_runs")
      .upsert(
        {
          observed_at: input.observedAt,
          observation_minute: input.minute,
          trading_date: input.tradingDate,
          methodology_version: PROX_TRANSITION_MEMORY_VERSION,
          source_pair_count: pairs.length,
          persisted_case_count: persistedCaseCount,
          complete,
          case_tickers: caseTickers,
          diagnostics: {
            authority: "shadow_research_only",
            source: "canonical_observation_history",
            noPublicScore: true,
            noExecutionAuthority: true,
          },
          error_message: complete ? null : "Transition coverage mismatch.",
          updated_at: input.observedAt,
        },
        { onConflict: "observation_minute,methodology_version" },
      );
    if (runError) throw runError;
    return {
      available: true,
      sourcePairCount: pairs.length,
      persistedCaseCount,
      caseTickers,
      unavailableReason: null,
    };
  } catch (error: unknown) {
    return {
      available: false,
      sourcePairCount: 0,
      persistedCaseCount: 0,
      caseTickers: [],
      unavailableReason: getErrorMessage(
        error,
        "Canonical transition memory is unavailable; run migration 0015.",
      ),
    };
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!POLYGON_KEY) {
    return NextResponse.json(
      { error: "Missing POLYGON_API_KEY" },
      { status: 500 },
    );
  }

  const supabase = getSupabase();
  const now = new Date();
  const observedAt = now.toISOString();
  const minute = observationMinute(now);
  const marketClock = getProxEasternMarketClock(now);
  let runId: string | null = null;

  const { data: run, error: runError } = await supabase
    .from("prox_outcome_memory_runs")
    .insert({
      observed_at: observedAt,
      observation_minute: minute,
      methodology_version: PROX_OUTCOME_MEMORY_VERSION,
      status: "running",
      market_session: marketClock.session,
    })
    .select("id")
    .single();
  if (runError || !run?.id) {
    if (runError?.code === "23505") {
      const { data: existing } = await supabase
        .from("prox_outcome_memory_runs")
        .select("id,status,complete,completed_at")
        .eq("observation_minute", minute)
        .eq("methodology_version", PROX_OUTCOME_MEMORY_VERSION)
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
        error: "Pro X Outcome Memory schema is unavailable; run migration 0014.",
        detail: runError?.message ?? null,
      },
      { status: 500 },
    );
  }
  runId = String(run.id);

  try {
    const activeSince = new Date(
      now.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error: episodeError } = await supabase
      .from("prox_research_episodes")
      .select("*")
      .eq("methodology_version", PROX_OUTCOME_MEMORY_VERSION)
      .eq("status", "active")
      .gte("started_at", activeSince)
      .order("started_at", { ascending: true })
      .limit(ACTIVE_EPISODE_LIMIT);
    if (episodeError) throw episodeError;
    const episodes = (data ?? []) as EpisodeRow[];
    await ensureEpisodeHorizons(supabase, episodes);
    const outcomeRows = await readEpisodeOutcomes(
      supabase,
      episodes.map((episode) => episode.id),
    );
    const outcomesByEpisode = new Map<string, OutcomeRow[]>();
    for (const outcome of outcomeRows) {
      const group = outcomesByEpisode.get(outcome.episode_id) ?? [];
      group.push(outcome);
      outcomesByEpisode.set(outcome.episode_id, group);
    }

    const snapshot = episodes.length > 0 ? await fetchPolygonSnapshot() : [];
    const priceMap = snapshotPriceMap(snapshot);
    const affectedByCorporateAction =
      episodes.length > 0
        ? await readInterveningCorporateActions(
            supabase,
            episodes,
            marketClock.easternDate,
          )
        : new Set<string>();
    const episodeUpdates: Array<Record<string, unknown>> = [];
    const dueOutcomeUpdates: Array<Record<string, unknown>> = [];
    let dueOutcomeCount = 0;
    let unavailableOutcomeCount = 0;
    let updatedEpisodeCount = 0;

    for (const episode of episodes) {
      const currentSnapshot = priceMap.get(episode.ticker);
      const currentPrice = positiveNumber(currentSnapshot?.price);
      const sourceTimestampMs = currentSnapshot?.sourceTimestampMs ?? null;
      const sourceObservedAt =
        sourceTimestampMs !== null
          ? new Date(sourceTimestampMs).toISOString()
          : null;
      const episodeOutcomes = outcomesByEpisode.get(episode.id) ?? [];
      const returnByHorizon: Partial<Record<ProxOutcomeHorizon, number>> = {};
      for (const outcome of episodeOutcomes) {
        if (outcome.complete && outcome.return_percent !== null) {
          returnByHorizon[outcome.horizon] = finiteNumber(
            outcome.return_percent,
          );
        }
      }
      const dueOutcomes = episodeOutcomes.filter(
        (outcome) =>
          !outcome.complete &&
          new Date(outcome.target_at).getTime() <= now.getTime(),
      );
      dueOutcomeCount += dueOutcomes.length;

      if (affectedByCorporateAction.has(episode.id)) {
        unavailableOutcomeCount += dueOutcomes.length;
        episodeUpdates.push({
          ...episode,
          status: "quarantined",
          outcome_label: "corporate_action_distortion",
          outcome_reason:
            "A corporate action occurred after discovery; sampled raw prices were quarantined from calibration.",
          calibratable: false,
          completed_at: observedAt,
          updated_at: observedAt,
        });
        continue;
      }
      if (
        currentPrice === null ||
        sourceTimestampMs === null ||
        sourceTimestampMs < new Date(episode.latest_observed_at).getTime()
      ) {
        unavailableOutcomeCount += dueOutcomes.length;
        continue;
      }

      updatedEpisodeCount += 1;
      const entryPrice = finiteNumber(episode.entry_price);
      const previousHigh = finiteNumber(episode.sampled_high_price, entryPrice);
      const previousLow = finiteNumber(episode.sampled_low_price, entryPrice);
      const newHigh = Math.max(previousHigh, currentPrice);
      const newLow = Math.min(previousLow, currentPrice);
      const highChanged = newHigh > previousHigh;
      const lowChanged = newLow < previousLow;
      const maxGainPercent =
        computeProxReturnPercent(entryPrice, newHigh) ??
        finiteNumber(episode.max_gain_percent);
      const maxDrawdownPercent =
        computeProxReturnPercent(entryPrice, newLow) ??
        finiteNumber(episode.max_drawdown_percent);
      const sampledHighAt = highChanged
        ? (sourceObservedAt as string)
        : episode.sampled_high_at;
      const sampledLowAt = lowChanged
        ? (sourceObservedAt as string)
        : episode.sampled_low_at;
      const timeToPeakMinutes = Math.max(
        0,
        (new Date(sampledHighAt).getTime() -
          new Date(episode.started_at).getTime()) /
          60_000,
      );

      for (const outcome of dueOutcomes) {
        if (
          sourceTimestampMs <
          new Date(outcome.target_at).getTime() - 60_000
        ) {
          unavailableOutcomeCount += 1;
          continue;
        }
        const returnPercent = computeProxReturnPercent(
          entryPrice,
          currentPrice,
        );
        if (returnPercent === null) {
          unavailableOutcomeCount += 1;
          continue;
        }
        returnByHorizon[outcome.horizon] = returnPercent;
        dueOutcomeUpdates.push({
          episode_id: episode.id,
          horizon: outcome.horizon,
          target_at: outcome.target_at,
          measured_at: sourceObservedAt,
          measured_price: currentPrice,
          return_percent: returnPercent,
          measurement_source: SNAPSHOT_ENDPOINT,
          measurement_quality: "first_snapshot_at_or_after_target",
          complete: true,
          methodology_version: PROX_OUTCOME_MEMORY_VERSION,
          updated_at: observedAt,
        });
      }

      const label = labelProxOutcome({
        anomalyFlags: normalizeFlags(
          episode.initial_anomaly_flags,
        ) as Parameters<typeof labelProxOutcome>[0]["anomalyFlags"],
        maxGainPercent,
        maxDrawdownPercent,
        returnByHorizon,
      });
      const finalHorizonsComplete =
        returnByHorizon["24h"] !== undefined &&
        returnByHorizon.next_session !== undefined;
      episodeUpdates.push({
        ...episode,
        latest_price: currentPrice,
        latest_observed_at: sourceObservedAt,
        sampled_high_price: newHigh,
        sampled_high_at: sampledHighAt,
        sampled_low_price: newLow,
        sampled_low_at: sampledLowAt,
        max_gain_percent: maxGainPercent,
        max_drawdown_percent: maxDrawdownPercent,
        time_to_peak_minutes: Number(timeToPeakMinutes.toFixed(1)),
        outcome_label: label.ready ? label.label : episode.outcome_label,
        outcome_reason: label.reason,
        calibratable: label.ready && label.calibratable,
        status: finalHorizonsComplete ? "complete" : "active",
        completed_at: finalHorizonsComplete ? observedAt : null,
        updated_at: observedAt,
      });
    }

    await writeInBatches(dueOutcomeUpdates, async (batch) => {
      const { error } = await supabase
        .from("prox_research_episode_outcomes")
        .upsert(batch, { onConflict: "episode_id,horizon" });
      return { error };
    });
    await writeInBatches(episodeUpdates, async (batch) => {
      const { error } = await supabase
        .from("prox_research_episodes")
        .upsert(batch, { onConflict: "id" });
      return { error };
    });

    const calibrationCount = await writeCalibrations(supabase, observedAt);
    const transitionMemory = await materializeCanonicalTransitionCases({
      supabase,
      tradingDate: marketClock.easternDate,
      observedAt,
      minute,
    });
    const persistedOutcomeCount = dueOutcomeUpdates.length;
    const complete =
      dueOutcomeCount ===
      persistedOutcomeCount + unavailableOutcomeCount;
    const completedAt = new Date().toISOString();
    const diagnostics = {
      authority: "shadow_research_only",
      methodologyVersion: PROX_OUTCOME_MEMORY_VERSION,
      marketSession: marketClock.session,
      measurementQuality: "polygon_snapshot_5m_sampled",
      corporateActionQuarantines: affectedByCorporateAction.size,
      canonicalTransitionMemory: transitionMemory,
      noPublicScore: true,
    };
    const { error: completionError } = await supabase
      .from("prox_outcome_memory_runs")
      .update({
        status: complete ? "success" : "failed",
        snapshot_count: snapshot.length,
        active_episode_count: episodes.length,
        updated_episode_count: updatedEpisodeCount,
        due_outcome_count: dueOutcomeCount,
        persisted_outcome_count: persistedOutcomeCount,
        unavailable_outcome_count: unavailableOutcomeCount,
        calibration_count: calibrationCount,
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
        snapshotCount: snapshot.length,
        activeEpisodeCount: episodes.length,
        updatedEpisodeCount,
        dueOutcomeCount,
        persistedOutcomeCount,
        unavailableOutcomeCount,
        calibrationCount,
      },
      timestamp: completedAt,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(
      error,
      "Pro X Outcome Memory failed.",
    );
    if (runId) {
      await supabase
        .from("prox_outcome_memory_runs")
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
