import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveSnapshotPrice,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import {
  PROX_MARKET_DISCOVERY_MODE,
  PROX_MARKET_DISCOVERY_VERSION,
  evaluateProxMarketDiscovery,
  getProxEasternMarketClock,
  type ProxKnownCorporateAction,
  type ProxMarketDiscoveryObservation,
} from "@/lib/prox/market-discovery";
import { getErrorMessage } from "@/lib/error-message";
import {
  PROX_OUTCOME_MEMORY_VERSION,
  selectProxPatternSignature,
} from "@/lib/prox/outcome-memory";
import {
  loadSecurityMetadata,
  loadSecurityTypeRegistry,
} from "@/lib/security-metadata";
import {
  PROX_SECURITY_ROUTING_VERSION,
  routeProxSecurityType,
  selectProxRoutedResearchCandidates,
  type ProxInstrumentLane,
  type ProxSecurityMetadataState,
} from "@/lib/prox/security-routing";
import { probeMassiveRealtimeEntitlement } from "@/lib/massive-stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SNAPSHOT_ENDPOINT =
  "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers";
const SPLITS_ENDPOINT = "https://api.polygon.io/v3/reference/splits";
const PERSIST_BATCH_SIZE = 100;

type RoutedDiscoveryObservation = ProxMarketDiscoveryObservation & {
  securityType: string | null;
  instrumentLane: ProxInstrumentLane;
  opportunityEligible: boolean;
  metadataState: ProxSecurityMetadataState;
  securityRoutingReason: string;
};

type PolygonSplit = {
  id?: unknown;
  ticker?: unknown;
  execution_date?: unknown;
  split_from?: unknown;
  split_to?: unknown;
  adjustment_type?: unknown;
  historical_adjustment_factor?: unknown;
};

type StoredCorporateAction = ProxKnownCorporateAction & {
  ticker: string;
  historicalAdjustmentFactor: number | null;
  rawPayload: PolygonSplit;
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

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function observationMinute(date: Date) {
  const minute = new Date(date);
  minute.setUTCSeconds(0, 0);
  return minute.toISOString();
}

function isoDateDaysAgo(days: number) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function validTicker(value: unknown) {
  const ticker = String(value ?? "").toUpperCase().trim();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
}

function dateDistanceDays(left: string, right: string) {
  const leftMs = new Date(`${left}T12:00:00.000Z`).getTime();
  const rightMs = new Date(`${right}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return Infinity;
  return Math.abs(leftMs - rightMs) / (24 * 60 * 60 * 1000);
}

async function fetchPolygonSnapshot() {
  const response = await fetch(
    `${SNAPSHOT_ENDPOINT}?include_otc=false&apiKey=${POLYGON_KEY}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Polygon full-market snapshot failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    tickers?: PolygonSnapshotRow[];
  };
  const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];
  if (tickers.length === 0) {
    throw new Error("Polygon returned an empty full-market snapshot.");
  }
  return tickers;
}

async function fetchPolygonSplits(): Promise<{
  actions: StoredCorporateAction[];
  error: string | null;
}> {
  try {
    const params = new URLSearchParams({
      "execution_date.gte": isoDateDaysAgo(21),
      limit: "1000",
      sort: "execution_date",
      order: "desc",
      apiKey: POLYGON_KEY ?? "",
    });
    const response = await fetch(`${SPLITS_ENDPOINT}?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        actions: [],
        error: `Polygon split feed returned ${response.status}.`,
      };
    }
    const payload = (await response.json()) as { results?: PolygonSplit[] };
    const actions: StoredCorporateAction[] = [];
    for (const split of payload.results ?? []) {
      const ticker = validTicker(split.ticker);
      const executionDate = String(split.execution_date ?? "");
      const splitFrom = positiveNumber(split.split_from);
      const splitTo = positiveNumber(split.split_to);
      if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(executionDate)) continue;
      if (splitFrom === null || splitTo === null) continue;
      const sourceId = String(
        split.id ?? `${ticker}:${executionDate}:${splitFrom}:${splitTo}`,
      );
      actions.push({
        sourceId,
        ticker,
        executionDate,
        splitFrom,
        splitTo,
        adjustmentType:
          typeof split.adjustment_type === "string"
            ? split.adjustment_type
            : null,
        historicalAdjustmentFactor: finiteNumber(
          split.historical_adjustment_factor,
        ),
        rawPayload: split,
      });
    }
    return { actions, error: null };
  } catch (error: unknown) {
    return {
      actions: [],
      error: getErrorMessage(error, "Polygon split feed failed."),
    };
  }
}

async function persistCorporateActions(
  supabase: ReturnType<typeof getSupabase>,
  actions: StoredCorporateAction[],
  observedAt: string,
) {
  if (actions.length === 0) return;
  const rows = actions.map((action) => ({
    source_split_id: action.sourceId,
    ticker: action.ticker,
    execution_date: action.executionDate,
    split_from: action.splitFrom,
    split_to: action.splitTo,
    adjustment_type: action.adjustmentType,
    historical_adjustment_factor: action.historicalAdjustmentFactor,
    source_endpoint: SPLITS_ENDPOINT,
    raw_payload: action.rawPayload,
    last_seen_at: observedAt,
  }));
  for (let index = 0; index < rows.length; index += PERSIST_BATCH_SIZE) {
    const { error } = await supabase
      .from("prox_corporate_actions")
      .upsert(rows.slice(index, index + PERSIST_BATCH_SIZE), {
        onConflict: "source_split_id",
      });
    if (error) throw error;
  }
}

function buildCurrentActionMap(
  actions: StoredCorporateAction[],
  easternDate: string,
) {
  const map = new Map<string, StoredCorporateAction>();
  for (const action of actions) {
    // Normalize with a provider-confirmed action only on its execution date.
    // Historical actions remain stored for research, but must not suppress a
    // genuine organic move several sessions later.
    if (dateDistanceDays(action.executionDate, easternDate) !== 0) continue;
    const existing = map.get(action.ticker);
    if (!existing || action.executionDate > existing.executionDate) {
      map.set(action.ticker, action);
    }
  }
  return map;
}

function buildObservation(
  row: PolygonSnapshotRow,
  observedAt: string,
  marketClock: ReturnType<typeof getProxEasternMarketClock>,
  actionMap: Map<string, StoredCorporateAction>,
) {
  const ticker = validTicker(row.ticker);
  if (!ticker) return null;
  const price = resolveSnapshotPrice(row);
  const previousClose = positiveNumber(row.prevDay?.c);
  const sessionOpenPrice = positiveNumber(row.day?.o);
  const reportedHigh = positiveNumber(row.day?.h);
  const sessionHighPrice =
    price > 0 ? Math.max(reportedHigh ?? price, price) : reportedHigh;
  const sessionLowPrice = positiveNumber(row.day?.l);
  const currentVolume = Math.max(
    finiteNumber(row.day?.v) ?? 0,
    finiteNumber(row.min?.av) ?? 0,
  );
  const previousVolume = Math.max(0, finiteNumber(row.prevDay?.v) ?? 0);
  if (price <= 0 || currentVolume <= 0) return null;

  return evaluateProxMarketDiscovery({
    ticker,
    observedAt,
    marketSession: marketClock.session,
    expectedVolumeFraction: marketClock.expectedVolumeFraction,
    price,
    previousClose,
    sessionOpenPrice,
    sessionHighPrice,
    sessionLowPrice,
    currentVolume,
    previousVolume,
    reportedChangePercent: finiteNumber(row.todaysChangePerc),
    knownCorporateAction: actionMap.get(ticker) ?? null,
  });
}

function toObservationRow(
  observation: RoutedDiscoveryObservation,
  runId: string,
  minute: string,
  sourceRow: PolygonSnapshotRow | undefined,
) {
  return {
    run_id: runId,
    ticker: observation.ticker,
    observed_at: observation.observedAt,
    observation_minute: minute,
    engine_version: PROX_MARKET_DISCOVERY_VERSION,
    mode: PROX_MARKET_DISCOVERY_MODE,
    source_endpoint: SNAPSHOT_ENDPOINT,
    market_session: observation.marketSession,
    price: observation.price,
    previous_close: observation.previousClose,
    session_open_price: observation.sessionOpenPrice,
    session_high_price: observation.sessionHighPrice,
    session_low_price: observation.sessionLowPrice,
    raw_full_day_change_percent: observation.rawFullDayChangePercent,
    observed_change_percent: observation.observedChangePercent,
    session_change_percent: observation.sessionChangePercent,
    pullback_from_session_high_percent:
      observation.pullbackFromSessionHighPercent,
    current_volume: observation.currentVolume,
    previous_volume: observation.previousVolume,
    expected_volume_fraction: observation.expectedVolumeFraction,
    raw_volume_ratio: observation.rawVolumeRatio,
    time_adjusted_relative_volume:
      observation.timeAdjustedRelativeVolume,
    dollar_volume: observation.dollarVolume,
    corporate_action_suspected: observation.corporateActionSuspected,
    corporate_action_factor: observation.corporateActionFactor,
    corporate_action_source_id: observation.corporateActionSourceId,
    anomaly_flags: observation.anomalyFlags,
    research_priority: observation.researchPriority,
    security_type: observation.securityType,
    instrument_lane: observation.instrumentLane,
    opportunity_eligible: observation.opportunityEligible,
    metadata_state: observation.metadataState,
    reasons: observation.reasons,
    feature_snapshot: {
      observedChangePercent: observation.observedChangePercent,
      sessionChangePercent: observation.sessionChangePercent,
      pullbackFromSessionHighPercent:
        observation.pullbackFromSessionHighPercent,
      timeAdjustedRelativeVolume:
        observation.timeAdjustedRelativeVolume,
      dollarVolume: observation.dollarVolume,
      securityRoutingVersion: PROX_SECURITY_ROUTING_VERSION,
      securityRoutingReason: observation.securityRoutingReason,
    },
    source_payload: {
      ticker: observation.ticker,
      day: sourceRow?.day ?? null,
      minute: sourceRow?.min ?? null,
      previousDay: sourceRow?.prevDay ?? null,
      reportedChangePercent: sourceRow?.todaysChangePerc ?? null,
    },
  };
}

async function seedOutcomeEpisodes(
  supabase: ReturnType<typeof getSupabase>,
  selected: RoutedDiscoveryObservation[],
  observationIdByTicker: Map<string, string>,
  tradingDate: string,
) {
  const rows = selected
    .filter(
      (observation) =>
        observation.opportunityEligible &&
        observation.instrumentLane === "opportunity_equity" &&
        observationIdByTicker.has(observation.ticker),
    )
    .map((observation) => ({
      ticker: observation.ticker,
      trading_date: tradingDate,
      first_observation_id: observationIdByTicker.get(observation.ticker),
      started_at: observation.observedAt,
      market_session: observation.marketSession,
      methodology_version: PROX_OUTCOME_MEMORY_VERSION,
      security_type: observation.securityType,
      instrument_lane: observation.instrumentLane,
      pattern_signature: selectProxPatternSignature(
        observation.anomalyFlags,
      ),
      initial_anomaly_flags: observation.anomalyFlags,
      initial_reasons: observation.reasons,
      initial_feature_snapshot: {
        observedChangePercent: observation.observedChangePercent,
        rawFullDayChangePercent: observation.rawFullDayChangePercent,
        sessionChangePercent: observation.sessionChangePercent,
        pullbackFromSessionHighPercent:
          observation.pullbackFromSessionHighPercent,
        timeAdjustedRelativeVolume:
          observation.timeAdjustedRelativeVolume,
        dollarVolume: observation.dollarVolume,
      },
      source_entry_price: observation.price,
      entry_price: observation.price,
      raw_entry_change_percent: observation.rawFullDayChangePercent,
      observed_entry_change_percent: observation.observedChangePercent,
      entry_relative_volume: observation.timeAdjustedRelativeVolume,
      entry_dollar_volume: observation.dollarVolume,
      corporate_action_suspected: observation.corporateActionSuspected,
      status: observation.corporateActionSuspected
        ? "quarantined"
        : "active",
      latest_price: observation.price,
      latest_observed_at: observation.observedAt,
      sampled_high_price: observation.price,
      sampled_high_at: observation.observedAt,
      sampled_low_price: observation.price,
      sampled_low_at: observation.observedAt,
      max_gain_percent: 0,
      max_drawdown_percent: 0,
      time_to_peak_minutes: 0,
      outcome_label: observation.corporateActionSuspected
        ? "corporate_action_distortion"
        : "unlabeled",
      outcome_reason: observation.corporateActionSuspected
        ? "Corporate-action discontinuity quarantined from learning."
        : null,
      calibratable: false,
      measurement_quality: "polygon_snapshot_5m_sampled",
      completed_at: observation.corporateActionSuspected
        ? observation.observedAt
        : null,
      updated_at: observation.observedAt,
    }));
  if (rows.length === 0) {
    return { seeded: 0, unavailable: null as string | null };
  }

  let seeded = 0;
  for (let index = 0; index < rows.length; index += PERSIST_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("prox_research_episodes")
      .upsert(rows.slice(index, index + PERSIST_BATCH_SIZE), {
        onConflict: "ticker,trading_date,methodology_version",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      return { seeded, unavailable: error.message };
    }
    seeded += data?.length ?? 0;
  }
  return { seeded, unavailable: null as string | null };
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
  if (marketClock.session === "closed") {
    return NextResponse.json({
      success: true,
      skipped: "market_closed",
      engineVersion: PROX_MARKET_DISCOVERY_VERSION,
      authority: "shadow_research_only",
      timestamp: observedAt,
    });
  }
  let runId: string | null = null;

  const { data: run, error: runError } = await supabase
    .from("prox_market_discovery_runs")
    .insert({
      started_at: observedAt,
      observation_minute: minute,
      engine_version: PROX_MARKET_DISCOVERY_VERSION,
      mode: PROX_MARKET_DISCOVERY_MODE,
      market_session: marketClock.session,
      source_endpoint: SNAPSHOT_ENDPOINT,
      status: "running",
    })
    .select("id")
    .single();

  if (runError || !run?.id) {
    if (runError?.code === "23505") {
      const { data: existing } = await supabase
        .from("prox_market_discovery_runs")
        .select("id,status,complete,completed_at")
        .eq("observation_minute", minute)
        .eq("engine_version", PROX_MARKET_DISCOVERY_VERSION)
        .maybeSingle();
      return NextResponse.json({
        success: existing?.status === "success",
        deduplicated: true,
        run: existing ?? null,
        engineVersion: PROX_MARKET_DISCOVERY_VERSION,
        authority: "shadow_research_only",
        timestamp: new Date().toISOString(),
      });
    }
    return NextResponse.json(
      {
        error:
          "Pro X direct market discovery schema is unavailable; run migrations 0013 and 0017.",
        detail: runError?.message ?? null,
      },
      { status: 500 },
    );
  }
  runId = String(run.id);

  try {
    const [snapshot, splitResult, entitlement] = await Promise.all([
      fetchPolygonSnapshot(),
      fetchPolygonSplits(),
      probeMassiveRealtimeEntitlement(),
    ]);
    await persistCorporateActions(supabase, splitResult.actions, observedAt);
    const actionMap = buildCurrentActionMap(
      splitResult.actions,
      marketClock.easternDate,
    );
    const sourceByTicker = new Map<string, PolygonSnapshotRow>();
    const eligible: ProxMarketDiscoveryObservation[] = [];

    for (const row of snapshot) {
      const observation = buildObservation(
        row,
        observedAt,
        marketClock,
        actionMap,
      );
      if (!observation || !observation.eligibleForResearch) continue;
      sourceByTicker.set(observation.ticker, row);
      eligible.push(observation);
    }

    const [securityMetadata, securityTypeRegistry] = await Promise.all([
      loadSecurityMetadata(
        supabase,
        eligible.map((observation) => observation.ticker),
      ),
      loadSecurityTypeRegistry(supabase),
    ]);
    const routed: RoutedDiscoveryObservation[] = eligible.map((observation) => {
      const metadata = securityMetadata.byTicker.get(observation.ticker);
      const route = routeProxSecurityType(metadata?.security_type);
      return {
        ...observation,
        securityType: route.securityType,
        instrumentLane: route.instrumentLane,
        opportunityEligible: route.opportunityEligible,
        metadataState: route.metadataState,
        securityRoutingReason: route.reason,
      };
    });
    const selected = selectProxRoutedResearchCandidates(
      routed.filter(
        (observation) => observation.instrumentLane !== "excluded_asset",
      ),
    );
    const persistedRows: Array<{ id: string; ticker: string }> = [];
    const observationRows = selected.map((observation) =>
      toObservationRow(
        observation,
        runId as string,
        minute,
        sourceByTicker.get(observation.ticker),
      ),
    );

    for (
      let index = 0;
      index < observationRows.length;
      index += PERSIST_BATCH_SIZE
    ) {
      const { data, error } = await supabase
        .from("prox_market_discovery_observations")
        .insert(observationRows.slice(index, index + PERSIST_BATCH_SIZE))
        .select("id,ticker");
      if (error) throw error;
      persistedRows.push(
        ...((data ?? []) as Array<{ id: string; ticker: string }>),
      );
    }

    const observationIdByTicker = new Map(
      persistedRows.map((row) => [row.ticker, row.id]),
    );
    const queueRows = selected
      .filter((observation) => observationIdByTicker.has(observation.ticker))
      .map((observation) => ({
        ticker: observation.ticker,
        status: "queued",
        first_detected_at: observedAt,
        last_detected_at: observedAt,
        latest_observation_id: observationIdByTicker.get(observation.ticker),
        engine_version: PROX_MARKET_DISCOVERY_VERSION,
        research_priority: observation.researchPriority,
        security_type: observation.securityType,
        instrument_lane: observation.instrumentLane,
        opportunity_eligible: observation.opportunityEligible,
        metadata_state: observation.metadataState,
        anomaly_flags: observation.anomalyFlags,
        reasons: observation.reasons,
        updated_at: observedAt,
      }));
    for (let index = 0; index < queueRows.length; index += PERSIST_BATCH_SIZE) {
      const { error } = await supabase
        .from("prox_research_queue")
        .upsert(queueRows.slice(index, index + PERSIST_BATCH_SIZE), {
          onConflict: "ticker",
        });
      if (error) throw error;
    }
    const episodeSeed = await seedOutcomeEpisodes(
      supabase,
      selected,
      observationIdByTicker,
      marketClock.easternDate,
    );

    const persistedCount = persistedRows.length;
    const complete = persistedCount === selected.length;
    const laneCounts = routed.reduce<Record<ProxInstrumentLane, number>>(
      (counts, observation) => {
        counts[observation.instrumentLane] += 1;
        return counts;
      },
      {
        opportunity_equity: 0,
        market_context: 0,
        linked_instrument_context: 0,
        excluded_asset: 0,
        pending_verification: 0,
      },
    );
    const selectedLaneCounts = selected.reduce<
      Record<Exclude<ProxInstrumentLane, "excluded_asset">, number>
    >(
      (counts, observation) => {
        if (observation.instrumentLane !== "excluded_asset") {
          counts[observation.instrumentLane] += 1;
        }
        return counts;
      },
      {
        opportunity_equity: 0,
        market_context: 0,
        linked_instrument_context: 0,
        pending_verification: 0,
      },
    );
    const routedProviderTypes = new Set(
      routed
        .map((observation) => observation.securityType)
        .filter((value): value is string => Boolean(value)),
    );
    const providerTypes = new Set(
      securityTypeRegistry.rows.map((row) => row.security_type),
    );
    const unclassifiedProviderTypes = [...providerTypes].filter(
      (securityType) =>
        routeProxSecurityType(securityType).instrumentLane ===
        "pending_verification",
    );
    const diagnostics = {
      engineVersion: PROX_MARKET_DISCOVERY_VERSION,
      mode: PROX_MARKET_DISCOVERY_MODE,
      securityRoutingVersion: PROX_SECURITY_ROUTING_VERSION,
      marketSession: marketClock.session,
      expectedVolumeFraction: marketClock.expectedVolumeFraction,
      marketDataProvider: "massive_polygon",
      marketDataMode: entitlement.dataMode,
      realtimeLastTrade: entitlement.lastTrade,
      realtimeLastQuote: entitlement.lastQuote,
      splitFeedError: splitResult.error,
      securityMetadata: {
        cacheHits: securityMetadata.cacheHits,
        fetched: securityMetadata.fetched,
        fetchFailures: securityMetadata.fetchFailures,
        missing: routed.filter((observation) => observation.securityType === null)
          .length,
      },
      securityTypeRegistry: {
        source: securityTypeRegistry.source,
        fetchedAt: securityTypeRegistry.fetchedAt,
        providerError: securityTypeRegistry.providerError,
        providerTypeCount: providerTypes.size,
        routedProviderTypeCount: routedProviderTypes.size,
        unclassifiedProviderTypes,
      },
      laneCounts,
      selectedLaneCounts,
      outcomeEpisodesSeeded: episodeSeed.seeded,
      outcomeMemoryUnavailable: episodeSeed.unavailable,
      selectedTickers: selected.slice(0, 20).map((observation) => ({
        ticker: observation.ticker,
        researchPriority: observation.researchPriority,
        securityType: observation.securityType,
        instrumentLane: observation.instrumentLane,
        opportunityEligible: observation.opportunityEligible,
        flags: observation.anomalyFlags,
      })),
    };
    const completedAt = new Date().toISOString();
    const { error: completionError } = await supabase
      .from("prox_market_discovery_runs")
      .update({
        completed_at: completedAt,
        status: complete ? "success" : "failed",
        snapshot_count: snapshot.length,
        eligible_count: eligible.length,
        expected_observation_count: selected.length,
        persisted_observation_count: persistedCount,
        research_queued_count: queueRows.length,
        corporate_action_count: splitResult.actions.length,
        complete,
        diagnostics,
        error_message: complete ? null : "Observation coverage mismatch.",
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
        eligibleCount: eligible.length,
        persistedCount,
        researchQueuedCount: queueRows.length,
        corporateActionCount: splitResult.actions.length,
      },
      timestamp: completedAt,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(
      error,
      "Pro X direct market discovery failed.",
    );
    if (runId) {
      await supabase
        .from("prox_market_discovery_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          complete: false,
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return NextResponse.json(
      {
        error: message || "Pro X direct market discovery failed.",
        authority: "shadow_research_only",
        expectedMigration: "0017_prox_security_type_routing.sql",
      },
      { status: 500 },
    );
  }
}
