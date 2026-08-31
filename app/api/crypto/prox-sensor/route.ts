import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildFreshCryptoOpportunityFeedState,
  loadCoinbaseCurrentPrices,
} from "@/lib/crypto/coinbase-public";
import type {
  CryptoDiscoveryCandidate,
  CryptoDiscoveryPrice,
  CryptoOpportunity,
  CryptoOpportunityFeed,
} from "@/lib/crypto/contracts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const OUTCOME_QUERY_LIMIT = 50;
const DISCOVERY_OUTCOME_QUERY_LIMIT = 1000;
const DISCOVERY_WRITE_BATCH_SIZE = 100;

type ObservationRole = "hero" | "contender" | "radar";
type ObservedOpportunity = {
  opportunity: CryptoOpportunity;
  role: ObservationRole;
  rank: number;
};
type OutcomeHorizon = "15m" | "1h" | "4h" | "24h";
type PendingOutcomeRow = {
  id: string;
  product_id: string;
  entry_price: number;
};
type PendingDiscoveryOutcomeRow = Record<string, unknown> & {
  id: string;
  asset_id: string;
  symbol: string;
  entry_price_usd: number;
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
  return Boolean(CRON_SECRET) &&
    request.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function selectObserved(feed: CryptoOpportunityFeed) {
  const ranked: ObservedOpportunity[] = [
    ...(feed.hero
      ? [{ opportunity: feed.hero, role: "hero" as const, rank: 1 }]
      : []),
    ...feed.contenders.map((opportunity, index) => ({
      opportunity,
      role: "contender" as const,
      rank: index + 2,
    })),
    ...feed.radar.map((opportunity, index) => ({
      opportunity,
      role: "radar" as const,
      rank: index + 1,
    })),
  ];
  const seen = new Set<string>();
  return ranked.filter(({ opportunity }) => {
    if (seen.has(opportunity.productId)) return false;
    seen.add(opportunity.productId);
    return true;
  });
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

async function writeDiscoveryRowsInBatches(
  supabase: ReturnType<typeof getSupabase>,
  rows: PendingDiscoveryOutcomeRow[],
) {
  for (
    let index = 0;
    index < rows.length;
    index += DISCOVERY_WRITE_BATCH_SIZE
  ) {
    const { error } = await supabase
      .from("ht_crypto_discovery_observations")
      .upsert(rows.slice(index, index + DISCOVERY_WRITE_BATCH_SIZE), {
        onConflict: "id",
      });
    if (error) throw error;
  }
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
  const opportunityCount =
    Number(feed.hero !== null) + feed.contenders.length + feed.radar.length;
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

async function loadDueOutcomes(
  supabase: ReturnType<typeof getSupabase>,
  nowIso: string,
) {
  const horizons = [
    { horizon: "15m" as const, target: "target_15m_at", price: "price_15m" },
    { horizon: "1h" as const, target: "target_1h_at", price: "price_1h" },
    { horizon: "4h" as const, target: "target_4h_at", price: "price_4h" },
    { horizon: "24h" as const, target: "target_24h_at", price: "price_24h" },
  ];
  const results = await Promise.all(
    horizons.map(async ({ horizon, target, price }) => {
      const { data, error } = await supabase
        .from("ht_crypto_prox_observations")
        .select("id,product_id,entry_price")
        .is(price, null)
        .lte(target, nowIso)
        .order(target, { ascending: true })
        .limit(OUTCOME_QUERY_LIMIT);
      if (error) throw error;
      return {
        horizon,
        rows: (data ?? []) as PendingOutcomeRow[],
      };
    }),
  );

  const dueById = new Map<
    string,
    { row: PendingOutcomeRow; horizons: Set<OutcomeHorizon> }
  >();
  for (const result of results) {
    for (const row of result.rows) {
      const existing = dueById.get(row.id) ?? {
        row,
        horizons: new Set<OutcomeHorizon>(),
      };
      existing.horizons.add(result.horizon);
      dueById.set(row.id, existing);
    }
  }
  return dueById;
}

async function persistOutcomePrices(
  supabase: ReturnType<typeof getSupabase>,
  dueById: Awaited<ReturnType<typeof loadDueOutcomes>>,
  observedAt: string,
) {
  const productIds = [...new Set(
    [...dueById.values()].map(({ row }) => row.product_id),
  )];
  const currentPrices = await loadCoinbaseCurrentPrices(productIds);
  let outcomesUpdated = 0;
  let outcomesUnavailable = 0;

  for (const { row, horizons } of dueById.values()) {
    const currentPrice = currentPrices.get(row.product_id);
    const entryPrice = Number(row.entry_price);
    if (!currentPrice || currentPrice <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      outcomesUnavailable++;
      continue;
    }
    const returnPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const update: Record<string, unknown> = { updated_at: observedAt };
    for (const horizon of horizons) {
      update[`price_${horizon}`] = currentPrice;
      update[`return_${horizon}_percent`] = returnPercent;
      outcomesUpdated++;
    }
    const { error } = await supabase
      .from("ht_crypto_prox_observations")
      .update(update)
      .eq("id", row.id);
    if (error) throw error;
  }

  return { outcomesUpdated, outcomesUnavailable };
}

async function loadDueDiscoveryOutcomes(
  supabase: ReturnType<typeof getSupabase>,
  nowIso: string,
) {
  const horizons = [
    { horizon: "15m" as const, target: "target_15m_at", price: "price_15m_usd" },
    { horizon: "1h" as const, target: "target_1h_at", price: "price_1h_usd" },
    { horizon: "4h" as const, target: "target_4h_at", price: "price_4h_usd" },
    { horizon: "24h" as const, target: "target_24h_at", price: "price_24h_usd" },
  ];
  const results = await Promise.all(
    horizons.map(async ({ horizon, target, price }) => {
      const { data, error } = await supabase
        .from("ht_crypto_discovery_observations")
        .select("*")
        .is(price, null)
        .lte(target, nowIso)
        // asset_id changed from a bare "crypto:SYMBOL" format to a
        // venue-qualified "crypto:venue:productid" format when multi-venue
        // discovery landed. Rows written under the old format (confirmed
        // live: 49,583 of them) can never resolve — current price lookups
        // are keyed by the new format and will never match — so without
        // this filter they'd stay "overdue" forever and permanently red-flag
        // this health check. The historical rows themselves are left alone;
        // this only stops chasing outcomes that can't ever be found.
        .like("asset_id", "crypto:%:%")
        .order(target, { ascending: true })
        .limit(DISCOVERY_OUTCOME_QUERY_LIMIT);
      if (error) throw error;
      return {
        horizon,
        rows: (data ?? []) as PendingDiscoveryOutcomeRow[],
      };
    }),
  );

  const dueById = new Map<
    string,
    { row: PendingDiscoveryOutcomeRow; horizons: Set<OutcomeHorizon> }
  >();
  for (const result of results) {
    for (const row of result.rows) {
      const existing = dueById.get(row.id) ?? {
        row,
        horizons: new Set<OutcomeHorizon>(),
      };
      existing.horizons.add(result.horizon);
      dueById.set(row.id, existing);
    }
  }
  return dueById;
}

async function persistDiscoveryOutcomePrices(
  supabase: ReturnType<typeof getSupabase>,
  dueById: Awaited<ReturnType<typeof loadDueDiscoveryOutcomes>>,
  discoveryPrices: CryptoDiscoveryPrice[],
  observedAt: string,
) {
  const currentPrices = new Map(
    discoveryPrices.map((price) => [price.assetId, price.priceUsd]),
  );
  // The identity venue embedded in asset_id (e.g. "crypto:coinbase:tao-usd")
  // is whichever venue happened to report the symbol first, by fixed
  // priority, at discovery time. That can change by the time an outcome is
  // due -- the symbol may no longer be on that venue's shortlist -- which
  // would otherwise leave a resolvable row permanently stuck looking for an
  // asset_id that will never reappear. Falling back to a symbol match keeps
  // outcome tracking on the underlying asset instead of one venue's listing
  // of it.
  const currentPricesBySymbol = new Map(
    discoveryPrices.map((price) => [price.symbol, price.priceUsd]),
  );
  let outcomesUpdated = 0;
  let outcomesUnavailable = 0;
  const updates: PendingDiscoveryOutcomeRow[] = [];

  for (const { row, horizons } of dueById.values()) {
    const currentPrice =
      currentPrices.get(row.asset_id) ?? currentPricesBySymbol.get(row.symbol);
    const entryPrice = Number(row.entry_price_usd);
    if (
      !currentPrice ||
      currentPrice <= 0 ||
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0
    ) {
      outcomesUnavailable++;
      continue;
    }
    const returnPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const update: PendingDiscoveryOutcomeRow = {
      ...row,
      updated_at: observedAt,
    };
    for (const horizon of horizons) {
      update[`price_${horizon}_usd`] = currentPrice;
      update[`return_${horizon}_percent`] = returnPercent;
      outcomesUpdated++;
    }
    updates.push(update);
  }

  await writeDiscoveryRowsInBatches(supabase, updates);

  return { outcomesUpdated, outcomesUnavailable };
}

function discoveryObservationRow(
  candidate: CryptoDiscoveryCandidate,
  observedAt: string,
  observationMinute: string,
  now: Date,
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
    target_15m_at: addMinutes(now, 15),
    target_1h_at: addMinutes(now, 60),
    target_4h_at: addMinutes(now, 240),
    target_24h_at: addMinutes(now, 1_440),
    updated_at: observedAt,
  };
}

async function persistShadowDiscovery({
  supabase,
  feed,
  discoveryPrices,
  observedAt,
  observationMinute,
  now,
}: {
  supabase: ReturnType<typeof getSupabase>;
  feed: CryptoOpportunityFeed;
  discoveryPrices: CryptoDiscoveryPrice[];
  observedAt: string;
  observationMinute: string;
  now: Date;
}) {
  try {
    const candidates = feed.shadowDiscovery.candidates;
    const rows = candidates.map((candidate) =>
      discoveryObservationRow(candidate, observedAt, observationMinute, now)
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
    const dueOutcomes = await loadDueDiscoveryOutcomes(supabase, observedAt);
    const outcomeResult = await persistDiscoveryOutcomePrices(
      supabase,
      dueOutcomes,
      discoveryPrices,
      observedAt,
    );
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
        source_diagnostics: feed.shadowDiscovery.diagnostics,
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
  const observed = selectObserved(feed);
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
    target_15m_at: addMinutes(now, 15),
    target_1h_at: addMinutes(now, 60),
    target_4h_at: addMinutes(now, 240),
    target_24h_at: addMinutes(now, 1_440),
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
  const dueOutcomes = await loadDueOutcomes(supabase, observedAt);
  const outcomeResult = await persistOutcomePrices(
    supabase,
    dueOutcomes,
    observedAt,
  );
  const discoveryResult = await persistShadowDiscovery({
    supabase,
    feed,
    discoveryPrices: feedState.discoveryPrices,
    observedAt,
    observationMinute,
    now,
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
