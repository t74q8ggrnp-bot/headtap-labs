import "server-only";
import { buildMassiveCryptoChart } from "@/lib/massive-crypto-chart";
import type { MarketChartDisplayQuote } from "@/lib/market-chart";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";
import { fetchCoverageFallbackChart, fetchCoverageFallbackQuote } from "@/lib/crypto-display-fallback";

const ORIGIN = "https://api.massive.com";
class MassivePairUnavailable extends Error {}
export async function fetchMassiveCryptoQuotes(products: string[]) {
  const key = process.env.MASSIVE_CRYPTO_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim();
  if (!key) throw new Error("Massive crypto is not configured.");
  const tickers = products.map(product => `X:${product.replace(/-USD$/, "USD")}`);
  const response = await fetch(`${ORIGIN}/v2/snapshot/locale/global/markets/crypto/tickers?${new URLSearchParams({ tickers: tickers.join(",") })}`, {
    headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Massive crypto quotes unavailable.");
  const body = await response.json();
  const now = Date.now();
  const quotes: Record<string, MarketChartDisplayQuote> = {};
  for (const row of body.tickers ?? []) {
    if (!tickers.includes(row.ticker)) continue;
    const timestamp = row.lastTrade?.t;
    const price = row.lastTrade?.p;
    if (!Number.isFinite(timestamp) || timestamp < now - 86_400_000 || timestamp > now + 2_000 || !Number.isFinite(price) || price <= 0) continue;
    const product = products[tickers.indexOf(row.ticker)];
    quotes[product] = { price, asOf: new Date(timestamp).toISOString(), source: "massive_crypto_trade",
      changePercent: Number.isFinite(row.todaysChangePerc) ? row.todaysChangePerc : null,
      changeBasis: "24h_reference", live: now - timestamp <= DISPLAY_LIVE_MAX_AGE_MS };
  }
  // Only pairs absent from a successful provider response are eligible for the
  // existing exchange coverage fallback. Present but stale data stays stale.
  const missing = products.filter((_, index) => !(body.tickers ?? []).some((row: { ticker?: string }) => row.ticker === tickers[index]));
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async product => {
      try { quotes[product] = await fetchCoverageFallbackQuote(product); } catch { /* Explicitly unavailable; no invented price. */ }
    }));
  }
  return quotes;
}

export async function fetchMassiveCryptoChart(symbol: string, productId: string) {
  if (!/^[A-Z0-9]{1,20}$/.test(symbol) || productId !== `${symbol}-USD`) {
    throw new Error("A matching, unambiguous USD crypto product is required.");
  }
  const key = process.env.MASSIVE_CRYPTO_API_KEY?.trim() || process.env.POLYGON_API_KEY?.trim();
  if (!key) throw new Error("Massive crypto is not configured.");
  const ticker = `X:${symbol}USD`;
  const now = Date.now();
  const get = async (path: string) => {
    const response = await fetch(`${ORIGIN}${path}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) throw new MassivePairUnavailable("Massive USD pair unavailable");
    if (!response.ok) throw new Error(`Massive crypto data unavailable (${response.status}).`);
    return response.json();
  };
  try {
    const [snapshot, aggregate] = await Promise.all([
      get(`/v2/snapshot/locale/global/markets/crypto/tickers/${encodeURIComponent(ticker)}`),
      get(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${now - 86_400_000}/${now}?sort=asc&limit=2000`),
    ]);
    return { ...buildMassiveCryptoChart(symbol, snapshot, aggregate, Date.now()), intervalSeconds: 60,
      sourceLabel: "Massive crypto · consolidated USD · 1-minute candles" };
  } catch (error) {
    if (!(error instanceof MassivePairUnavailable)) throw error;
    return fetchCoverageFallbackChart(productId);
  }
}
