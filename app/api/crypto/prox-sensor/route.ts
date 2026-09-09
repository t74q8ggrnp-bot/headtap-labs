import { NextResponse } from "next/server";
import { legacyCryptoObservationOnly, legacyCryptoOutcomeQuarantine } from "@/lib/crypto/outcome-integrity";
import { createClient } from "@supabase/supabase-js";
import {
  buildFreshCryptoOpportunityFeedState,
} from "@/lib/crypto/coinbase-public";
import type {
  CryptoDiscoveryCandidate,
  CryptoOpportunity,
  CryptoOpportunityFeed,
} from "@/lib/crypto/contracts";
import { selectCryptoFrameObservations } from "@/lib/crypto/decision-authority";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

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
  return Boolean(CRON_SECRET) &&
    request.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function decisionSnapshot(opportunity: CryptoOpportunity) {
  return {
    change24hPercent: opportunity.change24hPercent,
    high24h: opportunity.high24h,
    low24h: opportunity.low24h,
    pullbackFromHighPercent: opportunity.pullbackFromHighPercent,
    rangePositionPercent: opportunity.rangePositionPercent,
    dollarVolume24h: opportunity.dollarVolume24h,
    relativeVolume: opportunity.relativeVolume,
    riskScore: opportunity.riskScore,
    pulseState: opportunity.pulseState,
    stage: opportunity.stage,
    riskTags: opportunity.riskTags,
    scoreBreakdown: opportunity.scoreBreakdown,
  };
}

async function persistDecisionFrame({
  supabase,
  feed,
  observationMinute,
  observedAt,
}: {
  supabase: ReturnType<typeof getSupabase>;
  feed: CryptoOpportunityFeed;
  observationMinute: string;
  observedAt: string;
}) {
  const opportunityCount = selectCryptoFrameObservations(feed).length;
  const { error } = await supabase
    .from("ht_crypto_decision_frames")
    .upsert({
      decision_at: feed.decisionFrame.decisionAt,
      decision_minute: observationMinute,
      fresh_until: feed.decisionFrame.freshUntil,
      methodology_version: feed.methodologyVersion,
      expected_opportunity_count: opportunityCount,
      complete: feed.decisionFrame.fresh,
      feed,
      diagnostics: feed.diagnostics,
      updated_at: observedAt,
    }, {
      onConflict: "decision_minute",
    });
  if (error) throw error;
  return opportunityCount;
}

function discoveryObservationRow(
  candidate: CryptoDiscoveryCandidate,
  observedAt: string,
  observationMinute: string,
) {
  return {
    asset_id: candidate.assetId,
    symbol: candidate.symbol,
    observed_at: observedAt,
    observation_minute: observationMinute,
    rank: candidate.rank,
    entry_price_usd: candidate.entryPriceUsd,
    proposed_opportunity_score: candidate.proposedOpportunityScore,
    observed_move_percent: candidate.observedMovePercent,
    dollar_volume: candidate.dollarVolume,
    venue_count: candidate.venueCount,
    methodology_version: "crypto-multivenue-discovery-v2",
    discovery_packet: candidate,
    ...legacyCryptoObservationOnly(),
    updated_at: observedAt,
  };
}

async function persistShadowDiscovery({
  supabase,
  feed,
  observedAt,
  observationMinute,
}: {
  supabase: ReturnType<typeof getSupabase>;
  feed: CryptoOpportunityFeed;
  observedAt: string;
  observationMinute: string;
}) {
  try {
    const candidates = feed.shadowDiscovery.candidates;
    const rows = candidates.map((candidate) =>
      discoveryObservationRow(candidate, observedAt, observationMinute)
    );
    if (rows.length > 0) {
      const { error } = await supabase
        .from("ht_crypto_discovery_observations")
        .upsert(rows, {
          onConflict: "asset_id,observation_minute",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    }
    const { count, error: countError } = await supabase
      .from("ht_crypto_discovery_observations")
      .select("*", { count: "exact", head: true })
      .eq("observation_minute", observationMinute);
    if (countError) throw countError;
    const persisted = count ?? 0;
    const outcomeResult = legacyCryptoOutcomeQuarantine();
    const { error: receiptError } = await supabase
      .from("ht_crypto_discovery_runs")
      .upsert({
        observed_at: observedAt,
        observation_minute: observationMinute,
        expected_candidate_count: rows.length,
        persisted_candidate_count: persisted,
        complete: persisted === rows.length,
        observed_assets: candidates.map((candidate) => ({
          assetId: candidate.assetId,
          symbol: candidate.symbol,
          rank: candidate.rank,
        })),
        source_diagnostics: { ...feed.shadowDiscovery.diagnostics, outcomeEvidence: outcomeResult },
        outcomes_updated: outcomeResult.outcomesUpdated,
        outcomes_unavailable: outcomeResult.outcomesUnavailable,
        updated_at: observedAt,
      }, {
        onConflict: "observation_minute",
      });
    if (receiptError) throw receiptError;
    return {
      schemaReady: true,
      complete: persisted === rows.length,
      expected: rows.length,
      persisted,
      outcomesUpdated: outcomeResult.outcomesUpdated,
      outcomesUnavailable: outcomeResult.outcomesUnavailable,
      error: null,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Shadow discovery must never fail invisibly. Persist a current receipt so
    // health reports the active failure instead of looking merely stale.
    try {
      await supabase
        .from("ht_crypto_discovery_runs")
        .upsert({
          observed_at: observedAt,
          observation_minute: observationMinute,
          expected_candidate_count: feed.shadowDiscovery.candidates.length,
          persisted_candidate_count: 0,
          complete: false,
          observed_assets: feed.shadowDiscovery.candidates.map((candidate) => ({
            assetId: candidate.assetId,
            symbol: candidate.symbol,
            rank: candidate.rank,
          })),
          source_diagnostics: {
            ...feed.shadowDiscovery.diagnostics,
            persistenceError: errorMessage,
          },
          outcomes_updated: 0,
          outcomes_unavailable: 0,
          updated_at: observedAt,
        }, {
          onConflict: "observation_minute",
        });
    } catch {
      // The caller still receives the original persistence failure below.
    }
    return {
      schemaReady: false,
      complete: false,
      expected: feed.shadowDiscovery.candidates.length,
      persisted: 0,
      outcomesUpdated: 0,
      outcomesUnavailable: 0,
      error: errorMessage,
    };
  }
}

async function collect() {
  const supabase = getSupabase();
  const now = new Date();
  const observedAt = now.toISOString();
  const observationMinute = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  ).toISOString();
  const feedState = await buildFreshCryptoOpportunityFeedState();
  const feed = feedState.feed;
  const observed = selectCryptoFrameObservations(feed);
  const frameOpportunityCount = await persistDecisionFrame({
    supabase,
    feed,
    observationMinute,
    observedAt,
  });
  const observationRows = observed.map(({ opportunity, role, rank }) => ({
    product_id: opportunity.productId,
    symbol: opportunity.symbol,
    observed_at: observedAt,
    observation_minute: observationMinute,
    role,
    rank,
    entry_price: opportunity.price,
    canonical_score: opportunity.opportunityScore,
    shadow_score: opportunity.proxIntelligence?.shadowOpportunityScore ?? null,
    proposed_score_adjustment:
      opportunity.proxIntelligence?.proposedScoreAdjustment ?? null,
    prox_state: opportunity.proxIntelligence?.state ?? null,
    prox_market_confirmation:
      opportunity.proxIntelligence?.marketConfirmation ?? null,
    methodology_version: feed.methodologyVersion,
    prox_packet: opportunity.proxIntelligence,
    decision_snapshot: decisionSnapshot(opportunity),
    ...legacyCryptoObservationOnly(),
    updated_at: observedAt,
  }));

  if (observationRows.length > 0) {
    const { error } = await supabase
      .from("ht_crypto_prox_observations")
      .upsert(observationRows, {
        onConflict: "product_id,observation_minute",
        ignoreDuplicates: true,
      });
    if (error) {
      throw new Error(`Crypto ProX observation write failed: ${error.message}`);
    }
  }

  const { count, error: countError } = await supabase
    .from("ht_crypto_prox_observations")
    .select("*", { count: "exact", head: true })
    .eq("observation_minute", observationMinute);
  if (countError) throw countError;
  const persistedObservationCount = count ?? 0;
  const outcomeResult = legacyCryptoOutcomeQuarantine();
  const discoveryResult = await persistShadowDiscovery({
    supabase,
    feed,
    observedAt,
    observationMinute,
  });

  const { error: receiptError } = await supabase
    .from("ht_crypto_prox_collection_runs")
    .upsert({
      observed_at: observedAt,
      observation_minute: observationMinute,
      expected_observation_count: observationRows.length,
      persisted_observation_count: persistedObservationCount,
      complete: persistedObservationCount === observationRows.length,
      observed_products: observed.map(({ opportunity, role, rank }) => ({
        productId: opportunity.productId,
        symbol: opportunity.symbol,
        role,
        rank,
        proxState: opportunity.proxIntelligence?.state ?? null,
      })),
      feed_diagnostics: {
        ...feed.diagnostics,
        shadowDiscovery: discoveryResult,
        outcomeEvidence: outcomeResult,
      },
      outcomes_updated: outcomeResult.outcomesUpdated,
      updated_at: observedAt,
    }, {
      onConflict: "observation_minute",
      ignoreDuplicates: true,
    });
  if (receiptError) throw receiptError;

  return {
    success: true,
    authority: "bounded_backend",
    methodologyVersion: feed.methodologyVersion,
    decisionFrame: {
      decisionAt: feed.decisionFrame.decisionAt,
      freshUntil: feed.decisionFrame.freshUntil,
      opportunityCount: frameOpportunityCount,
    },
    observed: observationRows.length,
    persisted: persistedObservationCount,
    proxPackets: observationRows.filter((row) => row.prox_packet).length,
    outcomesUpdated: outcomeResult.outcomesUpdated,
    outcomesUnavailable: outcomeResult.outcomesUnavailable,
    outcomeEvidence: outcomeResult,
    shadowDiscovery: discoveryResult,
    timestamp: observedAt,
  };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await collect(), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error: unknown) {
    console.error("[crypto-prox-sensor] collection failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Crypto ProX sensor failed.",
        authority: "bounded_backend",
      },
      { status: 500 },
    );
  }
}
