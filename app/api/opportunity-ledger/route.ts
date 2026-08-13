import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildCanonicalOpportunityFeed } from "@/lib/canonical-opportunity-feed";
import { getErrorMessage } from "@/lib/error-message";
import {
  MOMENTUM_RADAR_COUNT,
  MOMENTUM_RUNNER_UP_COUNT,
} from "@/lib/opportunity-model";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const UPDATE_CONCURRENCY = 10;

type DisplayRole = "hero" | "contender" | "radar";
type LedgerStrategy = "spot_momentum" | "before_the_crowd";
type OpportunitySnapshot = {
  ticker?: unknown;
  price?: unknown;
  displayPrice?: unknown;
  displayChange?: unknown;
  displayQuoteLive?: unknown;
  displayQuoteAsOf?: unknown;
  opportunityScore?: unknown;
  engineVersion?: unknown;
  change?: unknown;
  sessionOpenPrice?: unknown;
  changeFromOpenPercent?: unknown;
  sessionHighPrice?: unknown;
  pullbackFromSessionHighPercent?: unknown;
  scanSession?: unknown;
  relativeVolume?: unknown;
  momentumScore?: unknown;
  crowdScore?: unknown;
  trapScore?: unknown;
  catalystScore?: unknown;
  signalStrength?: unknown;
  qualityScore?: unknown;
  tradeQuality?: unknown;
  breakoutPotentialScore?: unknown;
  stage?: unknown;
  riskTags?: unknown;
  visibilityState?: unknown;
  sourceRunId?: unknown;
  explosionAssessment?: unknown;
  tradeFramework?: unknown;
  proxIntelligence?: {
    status?: unknown;
    supportFlags?: unknown;
    riskFlags?: unknown;
    pulse?: { state?: unknown } | null;
    scores?: { marketConfirmation?: unknown } | null;
  } | null;
};
type DisplayedOpportunity = {
  ticker: string;
  price: number;
  score: number;
  role: DisplayRole;
  rank: number;
  strategy: LedgerStrategy;
  visibilityState: string | null;
  sourceRunId: string | null;
  engineVersion: string | null;
  proxState: string | null;
  proxConfirmation: number | null;
  decisionSnapshot: Record<string, unknown>;
};
type LedgerRow = {
  id: string;
  ticker: string;
  strategy: string;
  first_seen_at: string;
  first_seen_price: number;
  latest_role: string;
  hero_first_at: string | null;
  contender_first_at: string | null;
  radar_first_at: string | null;
  hit_5_at: string | null;
  hit_10_at: string | null;
  hit_20_at: string | null;
  hit_minus_5_at: string | null;
  hit_minus_10_at: string | null;
  finalized_at: string | null;
};
type MinuteBar = {
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  t?: unknown;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase credentials.");
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  return Boolean(CRON_SECRET) && req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function easternDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function easternMinuteOfDay(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactDecisionSnapshot(opportunity: OpportunitySnapshot) {
  const prox = opportunity.proxIntelligence;
  return {
    changePercent: finiteNumber(opportunity.change),
    displayedChangePercent:
      finiteNumber(opportunity.displayChange) ?? finiteNumber(opportunity.change),
    displayQuoteLive: opportunity.displayQuoteLive === true,
    displayQuoteAsOf: opportunity.displayQuoteAsOf
      ? String(opportunity.displayQuoteAsOf)
      : null,
    sessionOpenPrice: finiteNumber(opportunity.sessionOpenPrice),
    changeFromOpenPercent: finiteNumber(opportunity.changeFromOpenPercent),
    sessionHighPrice: finiteNumber(opportunity.sessionHighPrice),
    pullbackFromSessionHighPercent: finiteNumber(
      opportunity.pullbackFromSessionHighPercent,
    ),
    scanSession: opportunity.scanSession
      ? String(opportunity.scanSession)
      : null,
    relativeVolume: finiteNumber(opportunity.relativeVolume),
    momentumScore: finiteNumber(opportunity.momentumScore),
    crowdScore: finiteNumber(opportunity.crowdScore),
    trapScore: finiteNumber(opportunity.trapScore),
    catalystScore: finiteNumber(opportunity.catalystScore),
    signalStrength: finiteNumber(opportunity.signalStrength),
    qualityScore: finiteNumber(opportunity.qualityScore),
    tradeQuality: finiteNumber(opportunity.tradeQuality),
    breakoutPotentialScore: finiteNumber(
      opportunity.breakoutPotentialScore,
    ),
    stage: opportunity.stage ? String(opportunity.stage) : null,
    riskTags: Array.isArray(opportunity.riskTags)
      ? opportunity.riskTags.map(String)
      : [],
    explosionAssessment: opportunity.explosionAssessment ?? null,
    tradeFramework: opportunity.tradeFramework ?? null,
    prox: prox
      ? {
          status: prox.status ? String(prox.status) : null,
          pulse: prox.pulse ?? null,
          scores: prox.scores ?? null,
          supportFlags: Array.isArray(prox.supportFlags)
            ? prox.supportFlags.map(String)
            : [],
          riskFlags: Array.isArray(prox.riskFlags)
            ? prox.riskFlags.map(String)
            : [],
        }
      : null,
  };
}

function mapDisplayed(
  opportunity: OpportunitySnapshot,
  role: DisplayRole,
  rank: number,
  strategy: LedgerStrategy,
): DisplayedOpportunity | null {
  const ticker = String(opportunity.ticker ?? "").trim().toUpperCase();
  const price =
    finiteNumber(opportunity.displayPrice) ?? finiteNumber(opportunity.price);
  if (!ticker || price === null || price <= 0) return null;
  return {
    ticker,
    price,
    score: finiteNumber(opportunity.opportunityScore) ?? 0,
    role,
    rank,
    strategy,
    visibilityState: opportunity.visibilityState
      ? String(opportunity.visibilityState)
      : null,
    sourceRunId: opportunity.sourceRunId
      ? String(opportunity.sourceRunId)
      : null,
    engineVersion: opportunity.engineVersion
      ? String(opportunity.engineVersion)
      : null,
    proxState: opportunity.proxIntelligence?.pulse?.state
      ? String(opportunity.proxIntelligence.pulse.state)
      : null,
    proxConfirmation: finiteNumber(
      opportunity.proxIntelligence?.scores?.marketConfirmation,
    ),
    decisionSnapshot: compactDecisionSnapshot(opportunity),
  };
}

function selectDisplayed(
  payload: unknown,
  strategy: LedgerStrategy,
): DisplayedOpportunity[] {
  const source = payload && typeof payload === "object"
    ? payload as {
        opportunities?: unknown;
        momentumContenders?: unknown;
        momentumRadar?: unknown;
      }
    : {};
  const strict = Array.isArray(source.opportunities)
    ? source.opportunities as OpportunitySnapshot[]
    : [];
  const exactMomentumContenders = Array.isArray(source.momentumContenders)
    ? source.momentumContenders as OpportunitySnapshot[]
    : [];
  const exactMomentumRadar = Array.isArray(source.momentumRadar)
    ? source.momentumRadar as OpportunitySnapshot[]
    : [];
  const secondary = strategy === "spot_momentum"
    ? exactMomentumContenders
    : strict.slice(1, MOMENTUM_RUNNER_UP_COUNT + 1);
  const ranked = [
    ...(strict[0] ? [{ opportunity: strict[0], role: "hero" as const }] : []),
    ...secondary.map((opportunity) => ({
      opportunity,
      role:
        opportunity.visibilityState === "momentum_radar"
          ? "radar" as const
          : "contender" as const,
    })),
    ...(strategy === "spot_momentum"
      ? exactMomentumRadar.slice(0, MOMENTUM_RADAR_COUNT).map(
          (opportunity) => ({
            opportunity,
            role: "radar" as const,
          }),
        )
      : []),
  ];
  const seen = new Set<string>();
  const selected: DisplayedOpportunity[] = [];
  for (const { opportunity, role } of ranked) {
    const mapped = mapDisplayed(
      opportunity,
      role,
      selected.length + 1,
      strategy,
    );
    if (!mapped || seen.has(mapped.ticker)) continue;
    seen.add(mapped.ticker);
    selected.push(mapped);
    const displayLimit = strategy === "spot_momentum"
      ? MOMENTUM_RUNNER_UP_COUNT + MOMENTUM_RADAR_COUNT + 1
      : MOMENTUM_RUNNER_UP_COUNT + 1;
    if (selected.length >= displayLimit) break;
  }
  return selected;
}

async function fetchMinuteBars(ticker: string, tradingDate: string) {
  if (!POLYGON_KEY) return [];
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
    `/range/1/minute/${tradingDate}/${tradingDate}?adjusted=true&sort=asc&limit=1000&apiKey=${POLYGON_KEY}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return [];
  const payload: unknown = await response.json();
  const results = payload && typeof payload === "object" &&
    Array.isArray((payload as { results?: unknown }).results)
    ? (payload as { results: MinuteBar[] }).results
    : [];
  return results.map((bar) => ({
    high: Number(bar.h),
    low: Number(bar.l),
    close: Number(bar.c),
    timestamp: Number(bar.t),
  })).filter((bar) =>
    Number.isFinite(bar.high) && bar.high > 0 &&
    Number.isFinite(bar.low) && bar.low > 0 &&
    Number.isFinite(bar.close) && bar.close > 0 &&
    Number.isFinite(bar.timestamp) && bar.timestamp > 0,
  );
}

function firstThresholdAt(
  bars: Awaited<ReturnType<typeof fetchMinuteBars>>,
  threshold: number,
  direction: "above" | "below",
) {
  const bar = bars.find((candidate) =>
    direction === "above"
      ? candidate.high >= threshold
      : candidate.low <= threshold,
  );
  return bar ? new Date(bar.timestamp).toISOString() : null;
}

async function collect() {
  if (!POLYGON_KEY) throw new Error("Missing POLYGON_API_KEY.");
  const supabase = getSupabase();
  const now = new Date();
  const observedAt = now.toISOString();
  const observationMinute = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  ).toISOString();
  const tradingDate = easternDateString(now);
  const [spotMomentumFeed, beforeCrowdFeed] = await Promise.all([
    buildCanonicalOpportunityFeed({
      requestedType: "momentum",
      limit: 100,
    }),
    buildCanonicalOpportunityFeed({
      requestedType: "before_crowd",
      limit: 100,
    }),
  ]);
  const displayedByStrategy = {
    spot_momentum: selectDisplayed(spotMomentumFeed, "spot_momentum"),
    before_the_crowd: selectDisplayed(
      beforeCrowdFeed,
      "before_the_crowd",
    ),
  } satisfies Record<LedgerStrategy, DisplayedOpportunity[]>;
  const displayed = [
    ...displayedByStrategy.spot_momentum,
    ...displayedByStrategy.before_the_crowd,
  ];

  const { data: existingRows, error: existingError } = await supabase
    .from("ht_opportunity_ledger")
    .select("*")
    .eq("trading_date", tradingDate)
    .in("strategy", ["spot_momentum", "before_the_crowd"]);
  if (existingError) throw new Error(`Ledger read failed: ${existingError.message}`);
  const existingByTicker = new Map(
    ((existingRows ?? []) as LedgerRow[]).map((row) => [
      `${row.strategy}:${row.ticker}`,
      row,
    ]),
  );
  let inserted = 0;
  let roleTransitions = 0;
  const observations: Array<Record<string, unknown>> = [];

  for (const item of displayed) {
    const existing = existingByTicker.get(
      `${item.strategy}:${item.ticker}`,
    );
    let ledgerId: string;
    if (!existing) {
      const roleFields = item.role === "hero"
        ? { hero_first_at: observedAt, hero_first_price: item.price }
        : item.role === "contender"
          ? { contender_first_at: observedAt, contender_first_price: item.price }
          : { radar_first_at: observedAt, radar_first_price: item.price };
      const { data: created, error } = await supabase
        .from("ht_opportunity_ledger")
        .insert({
          trading_date: tradingDate,
          ticker: item.ticker,
          strategy: item.strategy,
          first_seen_at: observedAt,
          first_seen_price: item.price,
          first_role: item.role,
          first_rank: item.rank,
          first_score: item.score,
          first_visibility_state: item.visibilityState,
          first_source_run_id: item.sourceRunId,
          first_prox_state: item.proxState,
          first_prox_confirmation: item.proxConfirmation,
          latest_seen_at: observedAt,
          latest_price: item.price,
          latest_role: item.role,
          latest_rank: item.rank,
          latest_score: item.score,
          latest_visibility_state: item.visibilityState,
          latest_source_run_id: item.sourceRunId,
          latest_prox_state: item.proxState,
          latest_prox_confirmation: item.proxConfirmation,
          highest_price_after_signal: item.price,
          highest_price_at: observedAt,
          lowest_price_after_signal: item.price,
          lowest_price_at: observedAt,
          ...roleFields,
        })
        .select("id")
        .single();
      if (error || !created) throw new Error(`Ledger insert failed for ${item.ticker}: ${error?.message}`);
      ledgerId = created.id;
      const { error: roleEventError } = await supabase
        .from("ht_opportunity_role_events")
        .insert({
          ledger_id: created.id,
          ticker: item.ticker,
          strategy: item.strategy,
          role: item.role,
          rank: item.rank,
          price: item.price,
          score: item.score,
          visibility_state: item.visibilityState,
          source_run_id: item.sourceRunId,
          prox_state: item.proxState,
          prox_confirmation: item.proxConfirmation,
          observed_at: observedAt,
        });
      if (roleEventError) {
        throw new Error(
          `Initial role event failed for ${item.ticker}: ${roleEventError.message}`,
        );
      }
      inserted++;
    } else {
      ledgerId = existing.id;
      const roleChanged = existing.latest_role !== item.role;
      const roleFirstFields: Record<string, string | number> = {};
      if (item.role === "hero" && !existing.hero_first_at) {
        roleFirstFields.hero_first_at = observedAt;
        roleFirstFields.hero_first_price = item.price;
      }
      if (item.role === "contender" && !existing.contender_first_at) {
        roleFirstFields.contender_first_at = observedAt;
        roleFirstFields.contender_first_price = item.price;
      }
      if (item.role === "radar" && !existing.radar_first_at) {
        roleFirstFields.radar_first_at = observedAt;
        roleFirstFields.radar_first_price = item.price;
      }
      const { error } = await supabase.from("ht_opportunity_ledger").update({
        latest_seen_at: observedAt,
        latest_price: item.price,
        latest_role: item.role,
        latest_rank: item.rank,
        latest_score: item.score,
        latest_visibility_state: item.visibilityState,
        latest_source_run_id: item.sourceRunId,
        latest_prox_state: item.proxState,
        latest_prox_confirmation: item.proxConfirmation,
        updated_at: observedAt,
        ...roleFirstFields,
      }).eq("id", existing.id);
      if (error) throw new Error(`Ledger update failed for ${item.ticker}: ${error.message}`);
      if (roleChanged) {
        const { error: roleEventError } = await supabase
          .from("ht_opportunity_role_events")
          .insert({
            ledger_id: existing.id,
            ticker: item.ticker,
            strategy: item.strategy,
            role: item.role,
            rank: item.rank,
            price: item.price,
            score: item.score,
            visibility_state: item.visibilityState,
            source_run_id: item.sourceRunId,
            prox_state: item.proxState,
            prox_confirmation: item.proxConfirmation,
            observed_at: observedAt,
          });
        if (roleEventError) {
          throw new Error(
            `Role transition failed for ${item.ticker}: ${roleEventError.message}`,
          );
        }
        roleTransitions++;
      }
    }

    observations.push({
      ledger_id: ledgerId,
      trading_date: tradingDate,
      ticker: item.ticker,
      strategy: item.strategy,
      observed_at: observedAt,
      observation_minute: observationMinute,
      role: item.role,
      rank: item.rank,
      price: item.price,
      score: item.score,
      visibility_state: item.visibilityState,
      source_run_id: item.sourceRunId,
      engine_version: item.engineVersion,
      prox_state: item.proxState,
      prox_confirmation: item.proxConfirmation,
      decision_snapshot: item.decisionSnapshot,
    });
  }

  if (observations.length > 0) {
    const { error: observationError } = await supabase
      .from("ht_opportunity_observations")
      .upsert(observations, {
        onConflict: "ledger_id,observation_minute",
      });
    if (observationError) {
      throw new Error(
        `Opportunity observation write failed: ${observationError.message}`,
      );
    }
  }

  const { count: persistedObservationCount, error: observationCountError } =
    await supabase
      .from("ht_opportunity_observations")
      .select("*", { count: "exact", head: true })
      .eq("observation_minute", observationMinute);
  if (observationCountError) {
    throw new Error(
      `Opportunity observation verification failed: ${observationCountError.message}`,
    );
  }
  const expectedObservationCount = observations.length;
  const observedCount = persistedObservationCount ?? 0;
  const { error: collectionRunError } = await supabase
    .from("ht_opportunity_collection_runs")
    .upsert({
      trading_date: tradingDate,
      observed_at: observedAt,
      observation_minute: observationMinute,
      spot_momentum_count: displayedByStrategy.spot_momentum.length,
      before_crowd_count: displayedByStrategy.before_the_crowd.length,
      expected_observation_count: expectedObservationCount,
      persisted_observation_count: observedCount,
      complete: observedCount === expectedObservationCount,
      spot_momentum_tickers: displayedByStrategy.spot_momentum.map((item) => ({
        ticker: item.ticker,
        role: item.role,
        rank: item.rank,
        sourceRunId: item.sourceRunId,
      })),
      before_crowd_tickers: displayedByStrategy.before_the_crowd.map((item) => ({
        ticker: item.ticker,
        role: item.role,
        rank: item.rank,
        sourceRunId: item.sourceRunId,
      })),
    }, { onConflict: "observation_minute" });
  if (collectionRunError) {
    throw new Error(
      `Opportunity collection receipt failed: ${collectionRunError.message}`,
    );
  }

  const { data: activeRows, error: activeError } = await supabase
    .from("ht_opportunity_ledger")
    .select("*")
    .eq("trading_date", tradingDate)
    .in("strategy", ["spot_momentum", "before_the_crowd"]);
  if (activeError) throw new Error(`Active-ledger read failed: ${activeError.message}`);
  let outcomesUpdated = 0;
  let barsUnavailable = 0;
  const minuteBarsByTicker = new Map<
    string,
    ReturnType<typeof fetchMinuteBars>
  >();
  const loadMinuteBarsOnce = (ticker: string) => {
    const existing = minuteBarsByTicker.get(ticker);
    if (existing) return existing;
    const pending = fetchMinuteBars(ticker, tradingDate);
    minuteBarsByTicker.set(ticker, pending);
    return pending;
  };

  for (let index = 0; index < (activeRows ?? []).length; index += UPDATE_CONCURRENCY) {
    const batch = (activeRows ?? []).slice(index, index + UPDATE_CONCURRENCY) as LedgerRow[];
    const settled = await Promise.allSettled(batch.map(async (row) => {
      const firstSeenMs = new Date(row.first_seen_at).getTime();
      const bars = (await loadMinuteBarsOnce(row.ticker))
        .filter((bar) => bar.timestamp >= firstSeenMs);
      if (bars.length === 0) return false;
      const entry = Number(row.first_seen_price);
      let high = entry;
      let low = entry;
      let highAt = row.first_seen_at;
      let lowAt = row.first_seen_at;
      for (const bar of bars) {
        if (bar.high > high) {
          high = bar.high;
          highAt = new Date(bar.timestamp).toISOString();
        }
        if (bar.low < low) {
          low = bar.low;
          lowAt = new Date(bar.timestamp).toISOString();
        }
      }
      const regularBars = bars.filter((bar) => {
        const minute = easternMinuteOfDay(bar.timestamp);
        return minute >= 570 && minute < 960;
      });
      const regularClose = regularBars.at(-1)?.close ?? null;
      const update: Record<string, unknown> = {
        highest_price_after_signal: high,
        highest_price_at: highAt,
        lowest_price_after_signal: low,
        lowest_price_at: lowAt,
        max_gain_percent: ((high - entry) / entry) * 100,
        max_drawdown_percent: ((low - entry) / entry) * 100,
        time_to_peak_minutes: Math.max(0, (new Date(highAt).getTime() - firstSeenMs) / 60_000),
        last_bar_at: new Date(bars.at(-1)!.timestamp).toISOString(),
        regular_close_price: regularClose,
        regular_close_return_percent: regularClose === null ? null : ((regularClose - entry) / entry) * 100,
        updated_at: observedAt,
      };
      if (!row.hit_5_at) update.hit_5_at = firstThresholdAt(bars, entry * 1.05, "above");
      if (!row.hit_10_at) update.hit_10_at = firstThresholdAt(bars, entry * 1.10, "above");
      if (!row.hit_20_at) update.hit_20_at = firstThresholdAt(bars, entry * 1.20, "above");
      if (!row.hit_minus_5_at) update.hit_minus_5_at = firstThresholdAt(bars, entry * 0.95, "below");
      if (!row.hit_minus_10_at) update.hit_minus_10_at = firstThresholdAt(bars, entry * 0.90, "below");
      if (easternMinuteOfDay(now.getTime()) >= 1200 && !row.finalized_at) {
        update.finalized_at = observedAt;
      }
      const { error } = await supabase.from("ht_opportunity_ledger").update(update).eq("id", row.id);
      if (error) throw error;
      return true;
    }));
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) outcomesUpdated++;
      else barsUnavailable++;
    }
  }

  return {
    success: true,
    tradingDate,
    displayed: displayed.length,
    displayedByStrategy: {
      spotMomentum: displayedByStrategy.spot_momentum.length,
      beforeTheCrowd: displayedByStrategy.before_the_crowd.length,
    },
    inserted,
    roleTransitions,
    tracked: activeRows?.length ?? 0,
    observationsExpected: expectedObservationCount,
    observationsPersisted: observedCount,
    outcomesUpdated,
    barsUnavailable,
    timestamp: observedAt,
  };
}

async function readLedger(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.trim().toUpperCase();
  const strategy = url.searchParams.get("strategy")?.trim();
  const date = url.searchParams.get("date") ?? easternDateString();
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 50;
  let query = getSupabase()
    .from("ht_opportunity_ledger")
    .select("*")
    .eq("trading_date", date)
    .order("first_seen_at", { ascending: true })
    .limit(limit);
  if (ticker) query = query.eq("ticker", ticker);
  if (strategy === "spot_momentum" || strategy === "before_the_crowd") {
    query = query.eq("strategy", strategy);
  }
  const { data, error } = await query;
  if (error) throw error;
  return { outcomes: data ?? [], tradingDate: date, timestamp: new Date().toISOString() };
}

export async function GET(req: Request) {
  try {
    const result = isAuthorized(req) ? await collect() : await readLedger(req);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error: unknown) {
    console.error("[opportunity-ledger] request failed:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Opportunity ledger failed") },
      { status: 500 },
    );
  }
}
