import type { SupabaseClient } from "@supabase/supabase-js";
import { SECURITY_TYPE_POLICY, detectLeverage } from "@/lib/security-type-policy";

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const DEFAULT_STALE_HOURS = 24;
const DEFAULT_CONCURRENCY = 25;

export type SecurityMetadataRow = {
  ticker: string;
  security_type: string | null;
  is_supported: boolean;
  issuer_name: string | null;
  is_leveraged_or_inverse: boolean | null;
  fetched_at: string;
  source_last_updated_at: string | null;
  data_quality_state: "fresh" | "insufficient";
};

export type SecurityMetadataResult = {
  byTicker: Map<string, SecurityMetadataRow>;
  cacheHits: number;
  fetched: number;
  fetchFailures: number;
};

async function fetchMetadata(ticker: string): Promise<SecurityMetadataRow> {
  if (!POLYGON_KEY) throw new Error("Missing POLYGON_API_KEY.");
  const response = await fetch(
    `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${POLYGON_KEY}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Polygon metadata failed for ${ticker}: ${response.status}`);
  const data = await response.json();
  const result = data?.results;
  if (!result) throw new Error(`Polygon metadata returned no result for ${ticker}.`);
  const securityType = result.type ? String(result.type).toUpperCase() : null;
  const policy = securityType ? SECURITY_TYPE_POLICY[securityType] : undefined;
  return {
    ticker,
    security_type: securityType,
    is_supported: policy?.status === "supported",
    issuer_name: result.name ?? null,
    is_leveraged_or_inverse:
      securityType === "ETF" || securityType === "ETN"
        ? detectLeverage(result.name ?? null)
        : null,
    fetched_at: new Date().toISOString(),
    source_last_updated_at: result.last_updated_utc ?? null,
    data_quality_state: policy ? "fresh" : "insufficient",
  };
}

export async function loadSecurityMetadata(
  supabase: SupabaseClient,
  rawTickers: string[],
  options: { staleHours?: number; concurrency?: number } = {},
): Promise<SecurityMetadataResult> {
  const tickers = [...new Set(rawTickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
  const byTicker = new Map<string, SecurityMetadataRow>();
  if (tickers.length === 0) return { byTicker, cacheHits: 0, fetched: 0, fetchFailures: 0 };

  const { data: cachedRows, error: cacheError } = await supabase
    .from("ht_security_metadata")
    .select("ticker,security_type,is_supported,issuer_name,is_leveraged_or_inverse,fetched_at,source_last_updated_at,data_quality_state")
    .in("ticker", tickers);
  if (cacheError) throw new Error(`Security metadata cache read failed: ${cacheError.message}`);
  for (const row of cachedRows ?? []) {
    byTicker.set(String(row.ticker).toUpperCase(), row as SecurityMetadataRow);
  }

  const staleCutoff = Date.now() - (options.staleHours ?? DEFAULT_STALE_HOURS) * 60 * 60 * 1000;
  const needsFetch = tickers.filter((ticker) => {
    const cached = byTicker.get(ticker);
    const fetchedAt = cached?.fetched_at ? new Date(cached.fetched_at).getTime() : NaN;
    return !cached || !Number.isFinite(fetchedAt) || fetchedAt < staleCutoff;
  });
  const cacheHits = tickers.length - needsFetch.length;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const newRows: SecurityMetadataRow[] = [];
  let fetchFailures = 0;

  for (let index = 0; index < needsFetch.length; index += concurrency) {
    const batch = needsFetch.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map(fetchMetadata));
    for (const result of settled) {
      if (result.status === "fulfilled") {
        newRows.push(result.value);
        byTicker.set(result.value.ticker, result.value);
      } else {
        fetchFailures += 1;
      }
    }
  }

  if (newRows.length > 0) {
    const { error: writeError } = await supabase
      .from("ht_security_metadata")
      .upsert(newRows, { onConflict: "ticker" });
    if (writeError) throw new Error(`Security metadata cache write failed: ${writeError.message}`);
  }

  return { byTicker, cacheHits, fetched: newRows.length, fetchFailures };
}
