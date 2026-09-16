import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import {
  buildProxCanonicalPairedScorecard,
  type CanonicalPairCandidate,
  type ProxPairCandidate,
} from "@/lib/prox/paired-scorecard";
import {
  buildHtAgentCohortMetrics,
  HT_AGENT_METRIC_DECISION_LIMIT,
} from "@/lib/ht-agent/cohort-metrics";
import { HT_AGENT_COHORT_VERSION } from "@/lib/ht-agent/contracts";
import { summarizeAgentTargetCalibration } from "@/lib/ht-agent/target-calibration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
const READ_BATCH_SIZE = 200;
const READ_PAGE_SIZE = 1_000;
const MAX_READ_ROWS = 100_000;
function isAuthorized(request: Request) {
  return Boolean(CRON_SECRET) &&
    request.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalRole(value: unknown): CanonicalPairCandidate["role"] | null {
  return value === "hero" || value === "contender" || value === "radar"
    ? value
    : null;
}

function canonicalStrategy(value: unknown): CanonicalPairCandidate["strategy"] | null {
  return value === "spot_momentum" || value === "before_the_crowd"
    ? value
    : null;
}

function marketSession(value: unknown): ProxPairCandidate["marketSession"] | null {
  return value === "pre_market" || value === "regular" ||
    value === "after_hours" || value === "closed"
    ? value
    : null;
}

function proxDisposition(value: unknown): ProxPairCandidate["disposition"] | null {
  return value === "selected" || value === "blocked" || value === "rejected"
    ? value
    : null;
}

function proxRole(value: unknown): ProxPairCandidate["role"] | null {
  return value === "hero" || value === "contender" ||
    value === "radar" || value === "none"
    ? value
    : null;
}

function readiness(value: unknown): ProxPairCandidate["readiness"] | null {
  return value === "insufficient" || value === "live_only" ||
    value === "emerging" || value === "calibrated"
    ? value
    : null;
}

async function readInBatches<T>(
  ids: string[],
  reader: (batch: string[]) => Promise<T[]>,
) {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += READ_BATCH_SIZE) {
    rows.push(...await reader(ids.slice(index, index + READ_BATCH_SIZE)));
  }
  return rows;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const requestedDays = Number.parseInt(
      new URL(request.url).searchParams.get("days") ?? String(DEFAULT_WINDOW_DAYS),
      10,
    );
    const windowDays = Math.min(
      MAX_WINDOW_DAYS,
      Math.max(1, Number.isFinite(requestedDays) ? requestedDays : DEFAULT_WINDOW_DAYS),
    );
    const windowStart = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const supabase = getSupabase();

    const canonicalRows: Array<Record<string, unknown>> = [];
    let canonicalReadCapped = false;
    for (let offset = 0; offset < MAX_READ_ROWS; offset += READ_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("ht_opportunity_observations")
        .select("id,ticker,strategy,observed_at,price,score,role,rank,source_run_id,engine_version,decision_snapshot")
        .gte("observed_at", windowStart)
        .order("observed_at", { ascending: true })
        .range(offset, offset + READ_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Array<Record<string, unknown>>;
      canonicalRows.push(...page);
      if (page.length < READ_PAGE_SIZE) break;
      if (offset + READ_PAGE_SIZE >= MAX_READ_ROWS) canonicalReadCapped = true;
    }
    const episodeRows: Array<Record<string, unknown>> = [];
    let episodeReadCapped = false;
    for (let offset = 0; offset < MAX_READ_ROWS; offset += READ_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("prox_shadow_board_episode_representatives")
        .select("member_outcome_id,member_id,ticker,trading_date,market_session,decision_at,entry_price,max_gain_percent,max_drawdown_percent,sampled_high_at,sampled_low_at,disposition,role")
        .gte("decision_at", windowStart)
        .order("decision_at", { ascending: true })
        .range(offset, offset + READ_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Array<Record<string, unknown>>;
      episodeRows.push(...page);
      if (page.length < READ_PAGE_SIZE) break;
      if (offset + READ_PAGE_SIZE >= MAX_READ_ROWS) episodeReadCapped = true;
    }

    if (canonicalReadCapped || episodeReadCapped) {
      throw new Error(
        "Paired-scorecard source rows exceeded the bounded research window; request fewer days.",
      );
    }

    const memberIds = episodeRows.map((row) => String(row.member_id));
    const outcomeIds = episodeRows.map((row) => String(row.member_outcome_id));
    const memberRows = await readInBatches(memberIds, async (batch) => {
      const { data, error } = await supabase
        .from("prox_shadow_board_members")
        .select("id,run_id,decision_at,ticker,decision_price,edge_score,continuation_probability,evidence_confidence,readiness,disposition,role,rank,input_provenance")
        .in("id", batch);
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });
    const runIds = [...new Set(memberRows.map((row) => String(row.run_id)))];
    const runRows = await readInBatches(runIds, async (batch) => {
      const { data, error } = await supabase
        .from("prox_shadow_board_runs")
        .select("id,engine_version,edge_score_version,status,complete")
        .in("id", batch)
        .eq("status", "success")
        .eq("complete", true);
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });
    const horizonRows = await readInBatches(outcomeIds, async (batch) => {
      const { data, error } = await supabase
        .from("prox_shadow_board_member_outcome_horizons")
        .select("member_outcome_id,horizon,return_percent")
        .in("member_outcome_id", batch)
        .eq("complete", true)
        .eq("resolution_state", "measured");
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });

    const agentObservationReadLimit = HT_AGENT_METRIC_DECISION_LIMIT * 3;
    const { data: agentCohortData, error: agentCohortError } = await supabase
      .from("ht_agent_cohort_observations")
      .select("id,decision_id,frame_id,cohort,cohort_version,would_enter,observed_at")
      .eq("cohort_version", HT_AGENT_COHORT_VERSION)
      .gte("observed_at", windowStart)
      .order("observed_at", { ascending: false })
      .limit(agentObservationReadLimit);
    if (agentCohortError) throw agentCohortError;
    const agentCohortRows = (agentCohortData ?? []) as Array<Record<string, unknown>>;
    const agentCohortIds = agentCohortRows.map((row) => String(row.id));
    const agentOutcomeRows = await readInBatches(agentCohortIds, async (batch) => {
      const { data, error } = await supabase
        .from("ht_agent_outcomes")
        .select("cohort_observation_id,horizon,complete,return_percent,resolution_state")
        .in("cohort_observation_id", batch)
        .eq("horizon", "15m")
        .eq("complete", true);
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });
    const agentFrameIds = [...new Set(
      agentCohortRows.map((row) => String(row.frame_id)),
    )];
    const agentFrameRows = await readInBatches(agentFrameIds, async (batch) => {
      const { data, error } = await supabase
        .from("ht_agent_decision_frames")
        .select("id,symbol,provider_timestamp,canonical_decision_timestamp,prox_decision_timestamp,complete,frame_version")
        .in("id", batch)
        .eq("complete", true);
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });
    const agentCohortMetrics = buildHtAgentCohortMetrics(
      agentCohortRows.map((row) => ({
        id: String(row.id),
        decision_id: String(row.decision_id),
        cohort: String(row.cohort),
        cohort_version: String(row.cohort_version),
        would_enter: row.would_enter === true,
      })),
      agentOutcomeRows.map((row) => ({
        cohort_observation_id: String(row.cohort_observation_id),
        horizon: String(row.horizon),
        complete: row.complete === true && row.resolution_state === "measured",
        return_percent: row.return_percent,
      })),
    );
    const alignedAgentFrames = agentFrameRows.filter((row) => {
      const providerAt = new Date(String(row.provider_timestamp)).getTime();
      const canonicalAt = new Date(String(row.canonical_decision_timestamp)).getTime();
      const proxAt = new Date(String(row.prox_decision_timestamp)).getTime();
      if (![providerAt, canonicalAt, proxAt].every(Number.isFinite)) return false;
      return Math.max(providerAt, canonicalAt, proxAt) -
        Math.min(providerAt, canonicalAt, proxAt) <= 120_000;
    });

    const visualPlanRows: Array<Record<string, unknown>> = [];
    let visualPlanReadCapped = false;
    for (let offset = 0; offset < MAX_READ_ROWS; offset += READ_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("ht_agent_visual_plan_versions")
        .select("id,canonical_lane,target_one,target_two,target_one_risk_reward,target_two_risk_reward,provider_timestamp,created_at")
        .gte("provider_timestamp", windowStart)
        .order("provider_timestamp", { ascending: true })
        .range(offset, offset + READ_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Array<Record<string, unknown>>;
      visualPlanRows.push(...page);
      if (page.length < READ_PAGE_SIZE) break;
      if (offset + READ_PAGE_SIZE >= MAX_READ_ROWS) visualPlanReadCapped = true;
    }
    if (visualPlanReadCapped) {
      throw new Error(
        "Agent visual-plan rows exceeded the bounded research window; request fewer days.",
      );
    }
    const visualPlanIds = visualPlanRows.map((row) => String(row.id));
    const visualPlanEventRows = await readInBatches(visualPlanIds, async (batch) => {
      const { data, error } = await supabase
        .from("ht_agent_visual_plan_events")
        .select("plan_version_id,event_type,provider_timestamp,detail")
        .in("plan_version_id", batch);
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    });

    const canonicalCandidates = canonicalRows.flatMap((row) => {
      const snapshot = record(row.decision_snapshot);
      const decisionFrame = record(snapshot.decisionFrame);
      const strategy = canonicalStrategy(row.strategy);
      const role = canonicalRole(row.role);
      const price = number(row.price);
      const score = number(row.score);
      const rank = number(row.rank);
      if (!strategy || !role || price === null || score === null || rank === null) return [];
      return [{
        id: String(row.id),
        ticker: String(row.ticker),
        strategy,
        decisionAt: string(decisionFrame.decisionAsOf) ?? String(row.observed_at),
        providerAt: string(snapshot.displayQuoteAsOf),
        price,
        score,
        role,
        rank,
        sourceRunId: string(row.source_run_id),
        engineVersion: string(row.engine_version),
      } satisfies CanonicalPairCandidate];
    });

    const memberById = new Map(memberRows.map((row) => [String(row.id), row]));
    const runById = new Map(runRows.map((row) => [String(row.id), row]));
    const horizonsByOutcomeId = new Map<string, Record<string, number>>();
    for (const row of horizonRows) {
      const outcomeId = String(row.member_outcome_id);
      const horizon = string(row.horizon);
      const returnPercent = number(row.return_percent);
      if (!horizon || returnPercent === null) continue;
      const values = horizonsByOutcomeId.get(outcomeId) ?? {};
      values[horizon] = returnPercent;
      horizonsByOutcomeId.set(outcomeId, values);
    }

    const proxCandidates = episodeRows.flatMap((episode) => {
      const member = memberById.get(String(episode.member_id));
      const run = member ? runById.get(String(member.run_id)) : null;
      const provenance = record(member?.input_provenance);
      const session = marketSession(episode.market_session);
      const disposition = proxDisposition(episode.disposition);
      const role = proxRole(episode.role);
      const state = readiness(member?.readiness);
      const price = number(episode.entry_price);
      const edgeScore = number(member?.edge_score);
      const continuationProbability = number(member?.continuation_probability);
      const evidenceConfidence = number(member?.evidence_confidence);
      const maxGainPercent = number(episode.max_gain_percent);
      const maxDrawdownPercent = number(episode.max_drawdown_percent);
      if (
        !member || !run || !session || !disposition || !role || !state ||
        price === null || edgeScore === null || continuationProbability === null ||
        evidenceConfidence === null || maxGainPercent === null || maxDrawdownPercent === null
      ) return [];
      return [{
        episodeId: String(episode.member_outcome_id),
        memberId: String(episode.member_id),
        ticker: String(episode.ticker),
        tradingDate: String(episode.trading_date),
        marketSession: session,
        decisionAt: String(episode.decision_at),
        providerAt: string(provenance.pulseMarketAsOf),
        price,
        edgeScore,
        continuationProbability,
        evidenceConfidence,
        readiness: state,
        disposition,
        role,
        rank: number(member.rank),
        engineVersion: string(run.engine_version),
        edgeScoreVersion: string(run.edge_score_version),
        maxGainPercent,
        maxDrawdownPercent,
        sampledHighAt: String(episode.sampled_high_at),
        sampledLowAt: String(episode.sampled_low_at),
        horizons: horizonsByOutcomeId.get(String(episode.member_outcome_id)) ?? {},
      } satisfies ProxPairCandidate];
    });

    const report = buildProxCanonicalPairedScorecard(
      canonicalCandidates,
      proxCandidates,
    );
    return NextResponse.json({
      ok: true,
      windowDays,
      windowStart,
      ...report,
      pairs: report.pairs.slice(-250),
      pairRowsReturned: Math.min(250, report.pairs.length),
      pairRowsAvailable: report.pairs.length,
      agentResearch: {
        authority: "paper_only_research",
        cohortVersion: HT_AGENT_COHORT_VERSION,
        boundedObservationWindow: {
          latestDecisionLimit: HT_AGENT_METRIC_DECISION_LIMIT,
          observationReadLimit: agentObservationReadLimit,
          observationsRead: agentCohortRows.length,
          note: "Agent cohort metrics intentionally use the latest bounded complete three-way decision groups; the broader Canonical/ProX comparison retains the requested historical window.",
        },
        synchronization: {
          completeFrameCount: agentFrameRows.length,
          alignedFrameCount: alignedAgentFrames.length,
          misalignedOrUnavailableFrameCount:
            agentFrameRows.length - alignedAgentFrames.length,
          maximumAlignmentSeconds: 120,
        },
        cohortMetrics: agentCohortMetrics,
      },
      agentTargetCalibration: summarizeAgentTargetCalibration(
        visualPlanRows.map((row) => ({
          id: String(row.id),
          canonicalLane: String(row.canonical_lane),
          targetTwo: number(row.target_two),
        })),
        visualPlanEventRows.map((row) => ({
          planVersionId: String(row.plan_version_id),
          eventType: String(row.event_type),
          detail: record(row.detail),
        })),
      ),
      providerRequests: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: getErrorMessage(error, "Failed to build the paired ProX scorecard."),
      authority: "read_only_research",
      providerRequests: 0,
    }, { status: 500 });
  }
}
