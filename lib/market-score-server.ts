import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  mergeMarketBars,
  selectLatestEasternSessionBars,
  type MarketChartBar,
  type MarketChartDisplayQuote,
} from "./market-chart";
import {
  calculateHtMarketScore,
  type HtMarketScoreAssetKind,
  type HtMarketScoreReceipt,
} from "./market-score";

type StoredState = {
  asset_kind?: unknown;
  provider_as_of?: unknown;
  bars?: unknown;
};

type ObservationRow = {
  id: string;
  provider_as_of: string;
  observed_price: number;
  ht_market_score_outcomes?: Array<{ status?: string }> | { status?: string } | null;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  return url && key ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(4_000)])
          : AbortSignal.timeout(4_000),
      }),
    },
  }) : null;
}

function parseBars(value: unknown): MarketChartBar[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const bar = row as Record<string, unknown>;
    const parsed = {
      time: Number(bar.time),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume),
    };
    return Number.isFinite(parsed.time) && parsed.time > 0 &&
      [parsed.open, parsed.high, parsed.low, parsed.close].every((number) => Number.isFinite(number) && number > 0) &&
      Number.isFinite(parsed.volume) && parsed.volume >= 0
      ? [parsed]
      : [];
  });
}

function kindFromSecurityType(value: unknown): HtMarketScoreAssetKind {
  const securityType = String(value ?? "").toUpperCase();
  if (["ETF", "ETN", "ETV", "FUND"].includes(securityType)) return "etf";
  if (["CS", "ADRC"].includes(securityType)) return "stock";
  return "unknown";
}

export async function resolveHtMarketScoreAssetKind(
  symbol: string,
  db: SupabaseClient | null = client(),
): Promise<HtMarketScoreAssetKind> {
  if (!db) return "unknown";
  const { data } = await db
    .from("ht_security_metadata")
    .select("security_type")
    .eq("ticker", symbol)
    .maybeSingle();
  return kindFromSecurityType(data?.security_type);
}

function roundedPercent(price: number, basis: number) {
  return Number((((price - basis) / basis) * 100).toFixed(4));
}

async function reconcileOutcomes(
  db: SupabaseClient,
  symbol: string,
  bars: MarketChartBar[],
) {
  const earliest = bars.at(0);
  const latest = bars.at(-1);
  if (!earliest || !latest) return;
  const { data, error } = await db
    .from("ht_market_score_observations")
    .select("id,provider_as_of,observed_price,ht_market_score_outcomes(status)")
    .eq("symbol", symbol)
    .gte("provider_as_of", new Date(earliest.time * 1_000).toISOString())
    .order("provider_as_of", { ascending: true })
    .limit(500);
  if (error || !Array.isArray(data)) return;

  await Promise.all((data as ObservationRow[]).flatMap((observation) => {
    const outcome = Array.isArray(observation.ht_market_score_outcomes)
      ? observation.ht_market_score_outcomes[0]
      : observation.ht_market_score_outcomes;
    if (outcome?.status === "complete") return [];
    const observedAt = Date.parse(observation.provider_as_of) / 1_000;
    const path = bars.filter((bar) => bar.time >= observedAt);
    if (!path.length || !(observation.observed_price > 0)) return [];
    const closeAt = (minutes: number) => path.find((bar) => bar.time >= observedAt + minutes * 60)?.close ?? null;
    const return5 = closeAt(5);
    const return15 = closeAt(15);
    const return60 = closeAt(60);
    const high = Math.max(...path.map((bar) => bar.high));
    const low = Math.min(...path.map((bar) => bar.low));
    const status = return60 !== null ? "complete" : return5 !== null ? "partial" : "pending";
    return [db.rpc("ht_update_market_score_outcome", {
      p_observation_id: observation.id,
      p_return_5m_percent: return5 === null ? null : roundedPercent(return5, observation.observed_price),
      p_return_15m_percent: return15 === null ? null : roundedPercent(return15, observation.observed_price),
      p_return_60m_percent: return60 === null ? null : roundedPercent(return60, observation.observed_price),
      p_max_favorable_percent: roundedPercent(high, observation.observed_price),
      p_max_adverse_percent: roundedPercent(low, observation.observed_price),
      p_status: status,
    })];
  }));
}

async function persist(
  db: SupabaseClient,
  symbol: string,
  bars: MarketChartBar[],
  quote: MarketChartDisplayQuote,
  assetKind: HtMarketScoreAssetKind,
): Promise<HtMarketScoreReceipt | null> {
  const calculated = calculateHtMarketScore({ bars, quote, assetKind });
  if (!calculated) return null;
  const receipt: HtMarketScoreReceipt = { ...calculated, receiptState: "persisted" };
  const { data, error } = await db.rpc("ht_record_market_score_frame", {
    p_symbol: symbol,
    p_asset_kind: assetKind,
    p_provider_as_of: receipt.providerAsOf,
    p_bars: bars,
    p_quote: quote,
    p_score_receipt: receipt,
  });
  if (error || !data || typeof data !== "object") {
    console.warn("[ht-market-score] receipt unavailable", {
      symbol,
      code: error?.code ?? "invalid_receipt",
    });
    return null;
  }
  const persisted = data as { ok?: unknown; insertedObservation?: unknown };
  if (persisted.ok !== true) return null;
  if (persisted.insertedObservation === true) {
    await reconcileOutcomes(db, symbol, bars).catch(() => undefined);
  }
  return receipt;
}

export async function createHtMarketScoreFrame(input: {
  symbol: string;
  bars: MarketChartBar[];
  quote: MarketChartDisplayQuote;
}) {
  const db = client();
  if (!db) return null;
  const assetKind = await resolveHtMarketScoreAssetKind(input.symbol, db);
  return persist(db, input.symbol, selectLatestEasternSessionBars(input.bars), input.quote, assetKind);
}

export async function advanceHtMarketScoreFrame(input: {
  symbol: string;
  deltaBars: MarketChartBar[];
  quote: MarketChartDisplayQuote;
}) {
  const db = client();
  if (!db) return null;
  const { data, error } = await db
    .from("ht_market_score_states")
    .select("asset_kind,provider_as_of,bars")
    .eq("symbol", input.symbol)
    .maybeSingle();
  if (error || !data) return null;
  const state = data as StoredState;
  const storedBars = parseBars(state.bars);
  if (!storedBars.length) return null;
  const assetKind = ["stock", "etf", "unknown"].includes(String(state.asset_kind))
    ? state.asset_kind as HtMarketScoreAssetKind
    : "unknown";
  const bars = selectLatestEasternSessionBars(mergeMarketBars(storedBars, input.deltaBars));
  return persist(db, input.symbol, bars, input.quote, assetKind);
}
