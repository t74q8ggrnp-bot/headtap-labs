import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import {
  PROX_MARKET_DISCOVERY_VERSION,
} from "@/lib/prox/market-discovery";
import {
  PROX_MARKET_STRUCTURE_VERSION,
  assessProxMarketStructure,
  type ProxStructureBar,
} from "@/lib/prox/market-structure";
import {
  PROX_EDGE_SCORE_VERSION,
  scoreProxEdge,
  type ProxEdgeCalibrationEvidence,
  type ProxEdgeEventEvidence,
} from "@/lib/prox/edge-score";
import {
  PROX_SHADOW_BOARD_VERSION,
  buildProxShadowBoard,
  type ProxShadowBoardCandidate,
} from "@/lib/prox/shadow-board";
import {
  PROX_CALIBRATION_VERSION,
  PROX_OUTCOME_MEMORY_VERSION,
  selectProxPatternSignature,
} from "@/lib/prox/outcome-memory";
import { PROX_SECURITY_ROUTING_VERSION } from "@/lib/prox/security-routing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const MAX_EVALUATED_CANDIDATES = 30;
const FETCH_CONCURRENCY = 5;
const WRITE_BATCH_SIZE = 100;

type DiscoveryObservationRow = {
  id: string;
  ticker: string;
  observed_at: string;
  market_session: "pre_market" | "regular" | "after_hours" | "closed";
  price: number;
  time_adjusted_relative_volume: number | null;
  dollar_volume: number;
  raw_full_day_change_percent: number | null;
  session_change_percent: number | null;
  corporate_action_suspected: boolean;
  anomaly_flags: unknown;
  research_priority: number;
  security_type: "CS" | "ADRC";
};

type MarketFeatureRow = {
  ticker: string;
  price: number | null;
  velocity_1m: number | null;
  acceleration_5m: number | null;
  volume_acceleration: number | null;
  vwap: number | null;
  price_vs_vwap: number | null;
  window_high_price: number | null;
  pullback_from_window_high_percent: number | null;
  minutes_since_window_high: number | null;
  average_bar_range_percent: number | null;
  computed_at: string;
};

type EventLinkRow = {
  ticker: string;
  event_id: string;
  match_confidence: number | null;
  created_at: string;
};

type EventRow = {
  id: string;
  source_id: string | null;
  filed_at: string | null;
  catalyst_category: string | null;
  verification_state: string | null;
  confidence: number | null;
  contradictions: unknown;
};

type CalibrationRow = {
  pattern_signature: string;
  market_session: DiscoveryObservationRow["market_session"];
  sample_size: number;
  continuation_rate: number;
  evidence_state: "insufficient" | "emerging" | "calibrated";
};

type PolygonBar = {
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  t?: unknown;
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

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function observationMinute(date: Date) {
  const minute = new Date(date);
  minute.setUTCSeconds(0, 0);
  return minute.toISOString();
}

function easternDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isoDateDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function normalizeFlags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((flag): flag is string => typeof flag === "string")
    : [];
}

function parseBars(value: unknown): ProxStructureBar[] {
  if (!value || typeof value !== "object") return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return (results as PolygonBar[]).flatMap((bar) => {
    const timestamp = finite(bar.t);
    const open = positive(bar.o);
    const high = positive(bar.h);
    const low = positive(bar.l);
    const close = positive(bar.c);
    const volume = Math.max(0, finite(bar.v) ?? 0);
    if (
      timestamp === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      return [];
    }
    return [{ timestamp, open, high, low, close, volume }];
  });
}

async function fetchPolygonBars(
  ticker: string,
  multiplier: number,
  timespan: "minute" | "day",
  from: string,
  to: string,
  limit: number,
) {
  const params = new URLSearchParams({
    adjusted: "true",
    sort: "asc",
    limit: String(limit),
    apiKey: POLYGON_KEY ?? "",
  });
  const response = await fetch(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`${ticker} ${timespan} aggregates failed: ${response.status}`);
  }
  return parseBars(await response.json());
}

function calibrationKey(pattern: string, session: string) {
  return `${pattern}:${session}`;
}

async function loadEventEvidence(
  supabase: ReturnType<typeof getSupabase>,
  tickers: string[],
  nowMs: number,
) {
  const evidence = new Map<string, ProxEdgeEventEvidence>();
  if (tickers.length === 0) return evidence;
  const { data: links, error: linksError } = await supabase
    .from("prox_event_tickers")
    .select("ticker,event_id,match_confidence,created_at")
    .in("ticker", tickers)
    .order("created_at", { ascending: false });
  if (linksError) return evidence;
  const latestByTicker = new Map<string, EventLinkRow>();
  for (const link of (links ?? []) as EventLinkRow[]) {
    if (!latestByTicker.has(link.ticker)) latestByTicker.set(link.ticker, link);
  }
  const eventIds = [...new Set([...latestByTicker.values()].map((link) => link.event_id))];
  if (eventIds.length === 0) return evidence;
  const { data: events, error: eventsError } = await supabase
    .from("prox_events")
    .select("id,source_id,filed_at,catalyst_category,verification_state,confidence,contradictions")
    .in("id", eventIds);
  if (eventsError) return evidence;
  const eventById = new Map(
    ((events ?? []) as EventRow[]).map((event) => [event.id, event]),
  );
  const sourceIds = [
    ...new Set(
      ((events ?? []) as EventRow[])
        .map((event) => event.source_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const credibilityBySource = new Map<string, number>();
  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("prox_sources")
      .select("id,base_credibility")
      .in("id", sourceIds);
    for (const source of sources ?? []) {
      credibilityBySource.set(
        String(source.id),
        finite(source.base_credibility) ?? 50,
      );
    }
  }
  for (const [ticker, link] of latestByTicker) {
    const event = eventById.get(link.event_id);
    if (!event) continue;
    const filedAt = event.filed_at ? new Date(event.filed_at).getTime() : NaN;
    const ageMinutes = Number.isFinite(filedAt)
      ? Math.max(0, (nowMs - filedAt) / 60_000)
      : Infinity;
    const verificationState: ProxEdgeEventEvidence["verificationState"] =
      event.verification_state === "verified" ||
      event.verification_state === "contradicted"
        ? event.verification_state
        : "unverified";
    evidence.set(ticker, {
      verificationState,
      catalystCategory: event.catalyst_category ?? "unclassified",
      sourceCredibility:
        (event.source_id
          ? credibilityBySource.get(event.source_id)
          : null) ??
        finite(event.confidence) ??
        50,
      matchConfidence: finite(link.match_confidence) ?? 0,
      contradictionCount: Array.isArray(event.contradictions)
        ? event.contradictions.length
        : 0,
      ageMinutes,
    });
  }
  return evidence;
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
  const decisionAt = now.toISOString();
  const decisionMinute = observationMinute(now);
  const tradingDate = easternDateString(now);
  let runId: string | null = null;

  try {
    const { data: discoveryRun, error: discoveryError } = await supabase
      .from("prox_market_discovery_runs")
      .select("id,completed_at")
      .eq("engine_version", PROX_MARKET_DISCOVERY_VERSION)
      .eq("status", "success")
      .eq("complete", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (discoveryError) throw discoveryError;
    if (!discoveryRun?.id) {
      throw new Error("No completed security-routed ProX discovery run is available.");
    }

    const { data: run, error: runError } = await supabase
      .from("prox_shadow_board_runs")
      .insert({
        decision_at: decisionAt,
        decision_minute: decisionMinute,
        trading_date: tradingDate,
        engine_version: PROX_SHADOW_BOARD_VERSION,
        structure_version: PROX_MARKET_STRUCTURE_VERSION,
        edge_score_version: PROX_EDGE_SCORE_VERSION,
        security_routing_version: PROX_SECURITY_ROUTING_VERSION,
        source_discovery_run_id: discoveryRun.id,
        status: "running",
        authority: "shadow_research_only",
      })
      .select("id")
      .single();
    if (runError || !run?.id) {
      if (runError?.code === "23505") {
        const { data: existingRun, error: existingRunError } = await supabase
          .from("prox_shadow_board_runs")
          .select("id,status,complete,completed_at,error_message")
          .eq("decision_minute", decisionMinute)
          .eq("engine_version", PROX_SHADOW_BOARD_VERSION)
          .maybeSingle();
        if (existingRunError) throw existingRunError;
        const complete =
          existingRun?.status === "success" && existingRun.complete === true;
        return NextResponse.json(
          {
            success: complete,
            deduplicated: true,
            runId: existingRun?.id ?? null,
            status: existingRun?.status ?? "unknown",
            complete,
            error: existingRun?.error_message ?? null,
            engineVersion: PROX_SHADOW_BOARD_VERSION,
            authority: "shadow_research_only",
            timestamp: existingRun?.completed_at ?? new Date().toISOString(),
          },
          { status: complete ? 200 : 409 },
        );
      }
      throw runError ?? new Error("Could not create ProX shadow board run.");
    }
    runId = String(run.id);

    const { data: observations, error: observationsError } = await supabase
      .from("prox_market_discovery_observations")
      .select(
        "id,ticker,observed_at,market_session,price,time_adjusted_relative_volume,dollar_volume,raw_full_day_change_percent,session_change_percent,corporate_action_suspected,anomaly_flags,research_priority,security_type",
      )
      .eq("run_id", discoveryRun.id)
      .eq("instrument_lane", "opportunity_equity")
      .eq("opportunity_eligible", true)
      .order("research_priority", { ascending: false })
      .order("dollar_volume", { ascending: false })
      .limit(MAX_EVALUATED_CANDIDATES);
    if (observationsError) throw observationsError;
    const candidates = (observations ?? []) as DiscoveryObservationRow[];
    const tickers = candidates.map((candidate) => candidate.ticker);

    const [featuresResult, episodesResult, calibrationsResult, eventEvidence] =
      await Promise.all([
        tickers.length > 0
          ? supabase
              .from("prox_market_features")
              .select(
                "ticker,price,velocity_1m,acceleration_5m,volume_acceleration,vwap,price_vs_vwap,window_high_price,pullback_from_window_high_percent,minutes_since_window_high,average_bar_range_percent,computed_at",
              )
              .in("ticker", tickers)
          : Promise.resolve({ data: [], error: null }),
        tickers.length > 0
          ? supabase
              .from("prox_research_episodes")
              .select("ticker,started_at")
              .eq("methodology_version", PROX_OUTCOME_MEMORY_VERSION)
              .eq("trading_date", tradingDate)
              .in("ticker", tickers)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("prox_pattern_calibrations")
          .select(
            "pattern_signature,market_session,sample_size,continuation_rate,evidence_state",
          )
          .eq("methodology_version", PROX_CALIBRATION_VERSION),
        loadEventEvidence(supabase, tickers, now.getTime()),
      ]);
    if (featuresResult.error) throw featuresResult.error;
    if (episodesResult.error) throw episodesResult.error;
    if (calibrationsResult.error) throw calibrationsResult.error;

    const featureByTicker = new Map(
      ((featuresResult.data ?? []) as MarketFeatureRow[]).map((feature) => [
        feature.ticker,
        feature,
      ]),
    );
    const discoveredAtByTicker = new Map(
      (episodesResult.data ?? []).map((episode) => [
        String(episode.ticker),
        String(episode.started_at),
      ]),
    );
    const calibrationByPattern = new Map<string, ProxEdgeCalibrationEvidence>();
    for (const row of (calibrationsResult.data ?? []) as CalibrationRow[]) {
      calibrationByPattern.set(
        calibrationKey(row.pattern_signature, row.market_session),
        {
          sampleSize: Number(row.sample_size),
          continuationRate: Number(row.continuation_rate),
          evidenceState: row.evidence_state,
        },
      );
    }

    const historyByTicker = new Map<
      string,
      { daily: ProxStructureBar[]; intraday: ProxStructureBar[]; error: string | null }
    >();
    for (let index = 0; index < tickers.length; index += FETCH_CONCURRENCY) {
      const batch = tickers.slice(index, index + FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (ticker) => {
          const [daily, intraday] = await Promise.all([
            fetchPolygonBars(ticker, 1, "day", isoDateDaysAgo(140), tradingDate, 140),
            fetchPolygonBars(ticker, 1, "minute", tradingDate, tradingDate, 2_000),
          ]);
          const completedDaily = daily.filter(
            (bar) => easternDateString(new Date(bar.timestamp)) !== tradingDate,
          );
          return { ticker, daily: completedDaily, intraday };
        }),
      );
      settled.forEach((result, resultIndex) => {
        const ticker = batch[resultIndex];
        if (result.status === "fulfilled") {
          historyByTicker.set(ticker, { ...result.value, error: null });
        } else {
          historyByTicker.set(ticker, {
            daily: [],
            intraday: [],
            error: getErrorMessage(result.reason, "Polygon history failed."),
          });
        }
      });
    }

    const structureByTicker = new Map<
      string,
      ReturnType<typeof assessProxMarketStructure>
    >();
    const scoredCandidates: ProxShadowBoardCandidate[] = candidates.map(
      (candidate) => {
        const feature = featureByTicker.get(candidate.ticker) ?? null;
        const history = historyByTicker.get(candidate.ticker) ?? {
          daily: [],
          intraday: [],
          error: "No history was fetched.",
        };
        const pulsePrice = positive(feature?.price);
        const price = pulsePrice ?? Number(candidate.price);
        const structure = assessProxMarketStructure({
          price,
          vwap: positive(feature?.vwap),
          windowHighPrice: positive(feature?.window_high_price),
          pullbackFromWindowHighPercent: finite(
            feature?.pullback_from_window_high_percent,
          ),
          acceleration5m: finite(feature?.acceleration_5m),
          averageBarRangePercent: finite(
            feature?.average_bar_range_percent,
          ),
          dailyBars: history.daily,
          intradayBars: history.intraday,
        });
        structureByTicker.set(candidate.ticker, structure);
        const pulseComputedAt = feature?.computed_at
          ? new Date(feature.computed_at).getTime()
          : NaN;
        const pulseAgeMinutes = Number.isFinite(pulseComputedAt)
          ? Math.max(0, (now.getTime() - pulseComputedAt) / 60_000)
          : null;
        const observationAgeMinutes = Math.max(
          0,
          (now.getTime() - new Date(candidate.observed_at).getTime()) / 60_000,
        );
        const flags = normalizeFlags(candidate.anomaly_flags);
        const pattern = selectProxPatternSignature(
          flags as Parameters<typeof selectProxPatternSignature>[0],
        );
        const calibration =
          calibrationByPattern.get(
            calibrationKey(pattern, candidate.market_session),
          ) ?? null;
        const edge = scoreProxEdge({
          ticker: candidate.ticker,
          price,
          snapshotPrice: Number(candidate.price),
          sourceObservedAt: candidate.observed_at,
          decisionAt,
          securityType: candidate.security_type,
          previousCloseChangePercent: finite(
            candidate.raw_full_day_change_percent,
          ),
          sessionChangePercent: finite(candidate.session_change_percent),
          timeAdjustedRelativeVolume: finite(
            candidate.time_adjusted_relative_volume,
          ),
          dollarVolume: Number(candidate.dollar_volume),
          velocity1m: finite(feature?.velocity_1m),
          acceleration5m: finite(feature?.acceleration_5m),
          volumeAcceleration: finite(feature?.volume_acceleration),
          priceVsVwap: finite(feature?.price_vs_vwap),
          pulsePrice,
          pulseAgeMinutes,
          observationAgeMinutes,
          pullbackFromWindowHighPercent: finite(
            feature?.pullback_from_window_high_percent,
          ),
          corporateActionSuspected: candidate.corporate_action_suspected,
          anomalyFlags: flags,
          dailyBarCount: history.daily.length,
          intradayBarCount: history.intraday.length,
          structure,
          event: eventEvidence.get(candidate.ticker) ?? null,
          calibration,
        });
        if (history.error) {
          edge.reasons.push(history.error);
        }
        return {
          ticker: candidate.ticker,
          price,
          discoveredAt:
            discoveredAtByTicker.get(candidate.ticker) ??
            candidate.observed_at,
          sourceObservationId: candidate.id,
          sourceObservedAt: candidate.observed_at,
          marketSession: candidate.market_session,
          discoveryPattern: pattern,
          dollarVolume: Number(candidate.dollar_volume),
          edge,
        };
      },
    );
    const board = buildProxShadowBoard(scoredCandidates);
    const observationByTicker = new Map(
      candidates.map((candidate) => [candidate.ticker, candidate]),
    );
    const memberRows = board.map((member) => {
      const observation = observationByTicker.get(member.ticker) as DiscoveryObservationRow;
      const feature = featureByTicker.get(member.ticker) ?? null;
      const history = historyByTicker.get(member.ticker);
      const structure = structureByTicker.get(member.ticker);
      if (!structure) {
        throw new Error(`Missing independent structure for ${member.ticker}.`);
      }
      const event = eventEvidence.get(member.ticker) ?? null;
      return {
        run_id: runId,
        decision_at: decisionAt,
        ticker: member.ticker,
        source_observation_id: member.sourceObservationId,
        source_observed_at: member.sourceObservedAt,
        discovered_at: member.discoveredAt,
        market_session: member.marketSession,
        discovery_pattern: member.discoveryPattern,
        decision_price: member.price,
        security_type: observation.security_type,
        edge_score: member.edge.edgeScore,
        continuation_probability: member.edge.continuationProbability,
        reward_risk_asymmetry: member.edge.rewardRiskAsymmetry,
        evidence_confidence: member.edge.evidenceConfidence,
        risk_penalty: member.edge.riskPenalty,
        readiness: member.edge.readiness,
        entry_qualified: member.edge.entryQualified,
        role: member.role,
        disposition: member.disposition,
        rank: member.rank,
        disposition_reason: member.dispositionReason,
        structure_assessment: structure,
        edge_assessment: member.edge,
        event_evidence: event,
        hard_failures: member.edge.hardFailures,
        reasons: member.edge.reasons,
        input_provenance: {
          authority: "independent_prox_raw_facts_only",
          sourceDiscoveryRunId: discoveryRun.id,
          sourceObservationId: member.sourceObservationId,
          sourceObservedAt: member.sourceObservedAt,
          pulseComputedAt: feature?.computed_at ?? null,
          previousCloseChangePercent: finite(
            observation.raw_full_day_change_percent,
          ),
          sessionChangePercent: finite(observation.session_change_percent),
          dailyBarCount: history?.daily.length ?? 0,
          intradayBarCount: history?.intraday.length ?? 0,
          calibrationVersion: PROX_CALIBRATION_VERSION,
          canonicalFieldsConsumed: [],
        },
      };
    });
    let persistedCount = 0;
    const outcomeParentRows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < memberRows.length; index += WRITE_BATCH_SIZE) {
      const batch = memberRows.slice(index, index + WRITE_BATCH_SIZE);
      const { data, error } = await supabase
        .from("prox_shadow_board_members")
        .insert(batch)
        .select("id");
      if (error) throw error;
      persistedCount += data?.length ?? 0;
      (data ?? []).forEach((row, i) => {
        const member = batch[i];
        outcomeParentRows.push({
          member_id: row.id,
          ticker: member.ticker,
          trading_date: tradingDate,
          market_session: member.market_session,
          decision_at: member.decision_at,
          entry_price: member.decision_price,
          status: "active",
          latest_price: member.decision_price,
          latest_observed_at: member.decision_at,
          sampled_high_price: member.decision_price,
          sampled_high_at: member.decision_at,
          sampled_low_price: member.decision_price,
          sampled_low_at: member.decision_at,
        });
      });
    }
    // Seed the outcome-tracking parent row inline, same precedent as
    // prox-market-discovery seeding prox_research_episodes right after
    // writing its own observations -- prox-shadow-board-outcomes (the
    // companion cron) only resolves due rows, it never creates parents.
    for (
      let index = 0;
      index < outcomeParentRows.length;
      index += WRITE_BATCH_SIZE
    ) {
      const { error } = await supabase
        .from("prox_shadow_board_member_outcomes")
        .insert(outcomeParentRows.slice(index, index + WRITE_BATCH_SIZE));
      if (error) throw error;
    }

    const selected = board.filter((member) => member.disposition === "selected");
    const blocked = board.filter((member) => member.disposition === "blocked");
    const rejected = board.filter((member) => member.disposition === "rejected");
    const hero = board.find((member) => member.role === "hero") ?? null;
    const complete = persistedCount === board.length;
    const completedAt = new Date().toISOString();
    const diagnostics = {
      authority: "shadow_research_only",
      sourceDiscoveryRunId: discoveryRun.id,
      sourceDiscoveryCompletedAt: discoveryRun.completed_at,
      canonicalInputsConsumed: [],
      evaluatedTickers: board.map((member) => member.ticker),
      selectedTickers: selected.map((member) => member.ticker),
      blockedTickers: blocked.map((member) => member.ticker),
      rejectedTickers: rejected.map((member) => member.ticker),
      noPublicScore: true,
      noExecutionAuthority: true,
    };
    const { error: completionError } = await supabase
      .from("prox_shadow_board_runs")
      .update({
        status: complete ? "success" : "failed",
        complete,
        candidate_count: board.length,
        expected_member_count: board.length,
        persisted_member_count: persistedCount,
        selected_count: selected.length,
        blocked_count: blocked.length,
        rejected_count: rejected.length,
        hero_ticker: hero?.ticker ?? null,
        diagnostics,
        error_message: complete ? null : "Shadow board coverage mismatch.",
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", runId);
    if (completionError) throw completionError;

    return NextResponse.json({
      success: complete,
      authority: "shadow_research_only",
      engineVersion: PROX_SHADOW_BOARD_VERSION,
      diagnostics: {
        ...diagnostics,
        candidateCount: board.length,
        persistedCount,
        selectedCount: selected.length,
        blockedCount: blocked.length,
        rejectedCount: rejected.length,
        hero: hero
          ? {
              ticker: hero.ticker,
              price: hero.price,
              edgeScore: hero.edge.edgeScore,
              readiness: hero.edge.readiness,
            }
          : null,
      },
      timestamp: completedAt,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "ProX shadow board failed.");
    if (runId) {
      await supabase
        .from("prox_shadow_board_runs")
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
      {
        error: message,
        authority: "shadow_research_only",
        expectedMigration: "0018_prox_market_structure_shadow_board.sql",
      },
      { status: 500 },
    );
  }
}
