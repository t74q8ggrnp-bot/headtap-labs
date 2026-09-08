// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { normalizeOpportunity, type Opportunity } from "../opportunity-model.ts";

export const HT_AGENT_STOCK_UNIVERSE_VERSION = "ht-agent-stock-universe-v2-dual-lane" as const;
export const HT_AGENT_STOCK_LANES = ["momentum", "before_crowd"] as const;
export const HT_AGENT_CANDIDATES_PER_LANE = 6;
export type HtAgentStockLane = typeof HT_AGENT_STOCK_LANES[number];

export type HtAgentCanonicalLaneFrame = {
  opportunities?: readonly unknown[];
  sourceRun?: { id?: unknown };
  engineVersion?: unknown;
  decisionFrame?: { decisionAsOf?: unknown; fresh?: boolean };
};

export type HtAgentStockCandidate = {
  opportunity: Opportunity;
  lane: HtAgentStockLane;
  rank: number;
  sourceRunId: string;
  decisionTimestamp: string;
  providerTimestamp: string | null;
  engineVersion: string;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const timestamp = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const runId = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;

/** Recover the proposal's original strategy, never substitute the other lane. */
export function htAgentProposalLane(canonical: unknown): HtAgentStockLane | null {
  const strategy = record(canonical).strategy;
  return strategy === "spot_momentum" ? "momentum"
    : strategy === "before_the_crowd" ? "before_crowd" : null;
}

function readLane(
  lane: HtAgentStockLane,
  frame: HtAgentCanonicalLaneFrame | null,
  limit: number,
) {
  const decisionTimestamp = timestamp(frame?.decisionFrame?.decisionAsOf);
  const engineVersion = typeof frame?.engineVersion === "string" ? frame.engineVersion : null;
  const state = !frame ? "unavailable"
    : frame.decisionFrame?.fresh !== true ? "stale"
    : !decisionTimestamp || !engineVersion ? "invalid" : "ready";
  const records = Array.isArray(frame?.opportunities) ? frame.opportunities : [];
  const candidates: HtAgentStockCandidate[] = [];
  const omitted: Array<{ symbol: string; rank: number; reason: string }> = [];
  if (state === "ready" && decisionTimestamp && engineVersion) {
    for (const [index, raw] of records.slice(0, limit).entries()) {
      const source = record(raw);
      const opportunity = normalizeOpportunity(raw);
      const sourceRunId = runId(frame?.sourceRun?.id) ?? runId(source.sourceRunId);
      const reason = !opportunity.ticker.trim() ? "Missing symbol."
        : htAgentProposalLane(source) !== lane ? "Strategy does not match the source lane."
        : !sourceRunId ? "Authoritative source run is unavailable."
        : source.sourceRunId && source.sourceRunId !== sourceRunId ? "Candidate and frame source runs disagree."
        : null;
      if (reason || !sourceRunId) {
        omitted.push({ symbol: opportunity.ticker, rank: index + 1, reason: reason ?? "Missing source run." });
        continue;
      }
      candidates.push({
        opportunity,
        lane,
        rank: index + 1,
        sourceRunId,
        decisionTimestamp,
        // Processing/display time must not stand in for Canonical's provider time.
        providerTimestamp: timestamp(source.decisionQuoteAsOf),
        engineVersion,
      });
    }
  }
  return {
    candidates,
    receipt: {
      lane, state, sourceRunId: runId(frame?.sourceRun?.id), decisionTimestamp,
      publishedCount: records.length, consideredCount: state === "ready" ? Math.min(records.length, limit) : 0,
      validCount: candidates.length, omitted,
    },
  };
}

/** Evaluation coverage only. Canonical owns order, eligibility and every level. */
export function buildHtAgentStockUniverse(
  frames: Record<HtAgentStockLane, HtAgentCanonicalLaneFrame | null>,
) {
  const candidates: HtAgentStockCandidate[] = [];
  const seen = new Map<string, HtAgentStockCandidate>();
  const lanes = HT_AGENT_STOCK_LANES.map((lane) => readLane(lane, frames[lane], HT_AGENT_CANDIDATES_PER_LANE));
  const duplicates: Array<{ symbol: string; retainedLane: HtAgentStockLane; omittedLane: HtAgentStockLane; omittedRank: number }> = [];
  // Preserve the existing momentum processing order, then add Before the Crowd.
  // A shared symbol retains one whole primary-lane decision, never a mixture of
  // the strongest score/target/eligibility from two separate strategy records.
  for (const result of lanes) {
    for (const candidate of result.candidates) {
      const symbol = candidate.opportunity.ticker;
      const retained = seen.get(symbol);
      if (retained) {
        duplicates.push({ symbol, retainedLane: retained.lane, omittedLane: candidate.lane, omittedRank: candidate.rank });
        continue;
      }
      seen.set(symbol, candidate);
      candidates.push(candidate);
    }
  }
  return {
    candidates,
    coverage: {
      version: HT_AGENT_STOCK_UNIVERSE_VERSION,
      limitPerLane: HT_AGENT_CANDIDATES_PER_LANE,
      uniqueCandidateCount: candidates.length,
      lanes: lanes.map((result) => result.receipt),
      duplicates,
    },
  };
}

export async function loadHtAgentStockUniverse(
  loadFrame: (lane: HtAgentStockLane) => Promise<HtAgentCanonicalLaneFrame>,
) {
  const results = await Promise.allSettled(HT_AGENT_STOCK_LANES.map((lane) => loadFrame(lane)));
  // A source failure is visible in coverage. It must not stop management of
  // existing paper positions or be replaced with another lane's cached record.
  return buildHtAgentStockUniverse({
    momentum: results[0].status === "fulfilled" ? results[0].value : null,
    before_crowd: results[1].status === "fulfilled" ? results[1].value : null,
  });
}

export function findHtAgentProposalCandidate(
  lane: HtAgentStockLane,
  frame: HtAgentCanonicalLaneFrame,
  symbol: string,
) {
  // An already pending proposal may move below the cycle's bounded shortlist.
  // Revalidate its own current lane in full, still with the unchanged risk gate.
  return readLane(lane, frame, frame.opportunities?.length ?? 0).candidates
    .find((candidate) => candidate.opportunity.ticker === symbol.trim().toUpperCase()) ?? null;
}
