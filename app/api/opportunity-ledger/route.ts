import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildCanonicalOpportunityFeed } from "@/lib/canonical-opportunity-feed";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const UPDATE_CONCURRENCY = 10;

type DisplayRole = "hero" | "contender" | "radar";
type OpportunitySnapshot = {
  ticker?: unknown;
  price?: unknown;
  opportunityScore?: unknown;
  visibilityState?: unknown;
  sourceRunId?: unknown;
  proxIntelligence?: {
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
  visibilityState: string | null;
  sourceRunId: string | null;
  proxState: string | null;
  proxConfirmation: number | null;
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

function mapDisplayed(
  opportunity: OpportunitySnapshot,
  role: DisplayRole,
  rank: number,
): DisplayedOpportunity | null {
  const ticker = String(opportunity.ticker ?? "").trim().toUpperCase();
  const price = finiteNumber(opportunity.price);
  if (!ticker || price === null || price <= 0) return null;
  return {
    ticker,
    price,
    score: finiteNumber(opportunity.opportunityScore) ?? 0,
    role,
    rank,
    visibilityState: opportunity.visibilityState
      ? String(opportunity.visibilityState)
      : null,
    sourceRunId: opportunity.sourceRunId
      ? String(opportunity.sourceRunId)
      : null,
    proxState: opportunity.proxIntelligence?.pulse?.state
      ? String(opportunity.proxIntelligence.pulse.state)
      : null,
    proxConfirmation: finiteNumber(
      opportunity.proxIntelligence?.scores?.marketConfirmation,
    ),
  };
}

function selectDisplayed(payload: unknown): DisplayedOpportunity[] {
  const source = payload && typeof payload === "object"
    ? payload as { opportunities?: unknown; momentumRadar?: unknown }
    : {};
  const strict = Array.isArray(source.opportunities)
    ? source.opportunities as OpportunitySnapshot[]
    : [];
  const radar = Array.isArray(source.momentumRadar)
    ? source.momentumRadar as OpportunitySnapshot[]
    : [];
  const selected = [
    ...(strict[0] ? [{ opportunity: strict[0], role: "hero" as const }] : []),
    ...strict.slice(1, 3).map((opportunity) => ({ opportunity, role: "contender" as const })),
    ...radar.slice(0, 3).map((opportunity) => ({ opportunity, role: "radar" as const })),
  ];
  const seen = new Set<string>();
  return selected.flatMap(({ opportunity, role }, index) => {
    const mapped = mapDisplayed(opportunity, role, index + 1);
    if (!mapped || seen.has(mapped.ticker)) return [];
    seen.add(mapped.ticker);
    return [mapped];
  });
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
  const tradingDate = easternDateString(now);
  const feed = await buildCanonicalOpportunityFeed({
    requestedType: "momentum",
    limit: 100,
  });
  const displayed = selectDisplayed(feed);

  const { data: existingRows, error: existingError } = await supabase
    .from("ht_opportunity_ledger")
    .select("*")
    .eq("trading_date", tradingDate)
    .eq("strategy", "spot_momentum");
  if (existingError) throw new Error(`Ledger read failed: ${existingError.message}`);
  const existingByTicker = new Map(
    ((existingRows ?? []) as LedgerRow[]).map((row) => [row.ticker, row]),
  );
  let inserted = 0;
  let roleTransitions = 0;

  for (const item of displayed) {
    const existing = existingByTicker.get(item.ticker);
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
          strategy: "spot_momentum",
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
      const { error: roleEventError } = await supabase
        .from("ht_opportunity_role_events")
        .insert({
          ledger_id: created.id,
          ticker: item.ticker,
          strategy: "spot_momentum",
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
      continue;
    }

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
          strategy: "spot_momentum",
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

  const { data: activeRows, error: activeError } = await supabase
    .from("ht_opportunity_ledger")
    .select("*")
    .eq("trading_date", tradingDate)
    .eq("strategy", "spot_momentum");
  if (activeError) throw new Error(`Active-ledger read failed: ${activeError.message}`);
  let outcomesUpdated = 0;
  let barsUnavailable = 0;

  for (let index = 0; index < (activeRows ?? []).length; index += UPDATE_CONCURRENCY) {
    const batch = (activeRows ?? []).slice(index, index + UPDATE_CONCURRENCY) as LedgerRow[];
    const settled = await Promise.allSettled(batch.map(async (row) => {
      const firstSeenMs = new Date(row.first_seen_at).getTime();
      const bars = (await fetchMinuteBars(row.ticker, tradingDate))
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
    inserted,
    roleTransitions,
    tracked: activeRows?.length ?? 0,
    outcomesUpdated,
    barsUnavailable,
    timestamp: observedAt,
  };
}

async function readLedger(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.trim().toUpperCase();
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
