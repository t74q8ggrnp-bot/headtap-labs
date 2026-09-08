/** Vercel-only collection pilot. No order, public ranking or provider fallback authority. */
import type { CoinApiBar, CoinApiBook, CoinApiMarket, CoinApiTrade } from "./coinapi-normalize";
import type { CoinApiHistoryCache } from "./coinapi-history";
// @ts-expect-error Node source imports.
import { COINAPI_HISTORY_POLICY, hasCompleteCoinApiHistory, planCoinApiHistory, mergeCoinApiHistory, boundCoinApiHistory } from "./coinapi-history.ts";
// @ts-expect-error Node's test runner needs source extensions.
import { COINAPI_VENUES, parseCoinApiMarkets, parseCoinApiBars, parseCoinApiBook, parseCoinApiTrade } from "./coinapi-normalize.ts";
// @ts-expect-error Node's test runner needs source extensions.
import { coinApiResearchEvidence } from "./live-research-coinapi.ts";
// @ts-expect-error Node's test runner needs source extensions.
import { rankCryptoLiveResearch } from "./live-research.ts";
// @ts-expect-error Node's test runner needs source extensions.
import { evaluateCryptoAssetPolicy } from "./asset-policy.ts";

export const COINAPI_PILOT = Object.freeze({
  version: "coinapi-vercel-pilot-v1", intervalSeconds: 60,
  catalogTtlMs: 86_400_000, deepMarketsPerCycle: 2, maxCatalogMarkets: 5_000,
  // One quote batch plus at most two useful history requests; never fill unused slots.
  maxRequestsPerCycle: 4, selection: "prior-snapshot-momentum-plus-rotation-v1",
});

export type PilotQuote = {
  marketId: string; trade: CoinApiTrade | null; book: CoinApiBook | null; failures: string[];
};
export type PilotState = {
  catalogAt: string; catalog: CoinApiMarket[]; cursor: number;
  priorityMarket: string | null; previousQuotes: PilotQuote[];
  candleHistory?: Record<string, CoinApiHistoryCache>;
};
export type PilotClient = { get(path: string): Promise<unknown>; usage(): unknown };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Missing, malformed, conflicting and stale markets stay in the coverage denominator. */
export function parsePilotQuotes(payload: unknown, markets: CoinApiMarket[], now: number): PilotQuote[] {
  if (!Array.isArray(payload)) throw new Error("CoinAPI batch quote response is malformed.");
  const known = new Set(markets.map(m => m.symbolId));
  const byId = new Map<string, Record<string, unknown>>();
  const conflicts = new Set<string>();
  for (const raw of payload) {
    const row = record(raw), id = String(row.symbol_id ?? "");
    if (!known.has(id)) continue;
    const prior = byId.get(id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) conflicts.add(id);
    byId.set(id, row);
  }
  return markets.map(market => {
    const row = byId.get(market.symbolId);
    const quote: PilotQuote = { marketId: market.symbolId, trade: null, book: null, failures: [] };
    if (!row || conflicts.has(market.symbolId)) {
      quote.failures.push(row ? "conflicting_quote_versions" : "missing_provider_quote");
      return quote;
    }
    try {
      // Nested last_trade inherits ONLY its validated enclosing market identity.
      quote.trade = parseCoinApiTrade({ ...record(row.last_trade), symbol_id: row.symbol_id }, market.symbolId, now);
    } catch { quote.failures.push("invalid_provider_trade"); }
    try { quote.book = parseCoinApiBook(row, market.symbolId, now); }
    catch { quote.failures.push("invalid_provider_book"); }
    if (quote.trade && now - Date.parse(quote.trade.asOf) > 30_000) quote.failures.push("stale_trade");
    if (quote.book && now - Date.parse(quote.book.asOf) > 15_000) quote.failures.push("stale_book");
    if (quote.trade && quote.book && Math.abs(Date.parse(quote.trade.asOf) - Date.parse(quote.book.asOf)) > 15_000) {
      quote.failures.push("trade_book_misaligned");
    }
    return quote;
  });
}

/** A fetch queue, NOT a trading rank: one prior-snapshot mover + one fair rotation slot. */
export function selectPilotMarkets(markets: CoinApiMarket[], cursor: number, priorityMarket: string | null) {
  const candidates = markets.filter(m => evaluateCryptoAssetPolicy(m.base).allowed);
  const selected: CoinApiMarket[] = [];
  const priority = candidates.find(m => m.symbolId === priorityMarket);
  if (priority) selected.push(priority);
  const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  let traversed = 0;
  while (selected.length < COINAPI_PILOT.deepMarketsPerCycle && traversed < candidates.length) {
    const candidate = candidates[(start + traversed) % candidates.length];
    traversed++;
    if (!selected.some(m => m.symbolId === candidate.symbolId)) selected.push(candidate);
  }
  return { selected, cursor: candidates.length ? (start + traversed) % candidates.length : 0 };
}

function nextPriority(current: PilotQuote[], previous: PilotQuote[], markets: CoinApiMarket[]) {
  const prior = new Map(previous.map(q => [q.marketId, q]));
  const allowed = new Set(markets.filter(m => evaluateCryptoAssetPolicy(m.base).allowed).map(m => m.symbolId));
  return current.flatMap(q => {
    const old = prior.get(q.marketId);
    if (!allowed.has(q.marketId) || q.failures.length || !q.trade || !old?.trade || old.failures.length) return [];
    const elapsed = Date.parse(q.trade.asOf) - Date.parse(old.trade.asOf);
    // Compare actual successive market prints, not server-clock changes or stale baselines.
    const change = (q.trade.price / old.trade.price - 1) * 100;
    return elapsed >= 15_000 && elapsed <= 120_000 && Number.isFinite(change) && change > 0
      ? [{ id: q.marketId, change }] : [];
  }).sort((a, b) => b.change - a.change || a.id.localeCompare(b.id))[0]?.id ?? null;
}

export async function collectCoinApiPilot(client: PilotClient, previous: PilotState | null, now = Date.now) {
  let catalog = previous?.catalog ?? [];
  let catalogAt = previous?.catalogAt ?? "";
  const age = now() - Date.parse(catalogAt);
  if (!catalog.length || !Number.isFinite(age) || age < 0 || age >= COINAPI_PILOT.catalogTtlMs) {
    const payload = await client.get(`/v1/symbols?filter_exchange_id=${COINAPI_VENUES.join(",")}`);
    catalog = COINAPI_VENUES.flatMap(venue => parseCoinApiMarkets(payload, venue))
      .filter(m => m.quote === "USD").sort((a, b) => a.symbolId.localeCompare(b.symbolId));
    if (!catalog.length || catalog.length > COINAPI_PILOT.maxCatalogMarkets) throw new Error("CoinAPI catalog coverage is invalid.");
    catalogAt = new Date(now()).toISOString();
  }
  const queue = selectPilotMarkets(catalog, previous?.cursor ?? 0, previous?.priorityMarket ?? null);
  // One shared quote batch gates paid history. Stale/missing/misaligned sources
  // stay visible in coverage but cannot trigger two blind candle downloads.
  const rawQuotes = await client.get(`/v1/quotes/current?filter_exchange_id=${COINAPI_VENUES.join(",")}`);
  // Validate the batch itself before any history request.
  parsePilotQuotes(rawQuotes, catalog, now());
  const histories = new Map<string, CoinApiBar[]>();
  const historyFailures = new Map<string, string[]>();
  const candleHistory = { ...previous?.candleHistory };
  let historyCacheHits = 0;
  let historyRequests = 0;
  const historyDecisions: { marketId: string; reason: string; requested: boolean; receivedBars: number; reusedBars: number }[] = [];
  // Sequential, bounded requests: a usage/accounting failure stops the cycle before further spending.
  // Re-evaluate the original quote clocks after history: latency may cause
  // abstention, never a second paid quote fetch or a fabricated fresh timestamp.
  for (const market of queue.selected) {
    const selectedQuote = parsePilotQuotes(rawQuotes, [market], now())[0];
    if (selectedQuote.failures.length || !selectedQuote.trade || !selectedQuote.book) {
      const cached = candleHistory[market.symbolId];
      const retained = cached?.failure === "conflicting_or_invalid_candle_history" ? []
        : planCoinApiHistory(market.symbolId, cached, now()).cached;
      histories.set(market.symbolId, retained);
      historyFailures.set(market.symbolId, ["history_skipped_unusable_quote", ...(cached?.failure ? [cached.failure] : [])]);
      historyDecisions.push({ marketId: market.symbolId, reason: "unusable_quote", requested: false, receivedBars: 0, reusedBars: retained.length });
      continue;
    }
    const plan = planCoinApiHistory(market.symbolId, candleHistory[market.symbolId], now());
    // Transport/budget failures still abort the cycle. Data conflicts quarantine
    // this market, not every other valid market, and never reuse its old score.
    const raw = plan.path ? await client.get(plan.path) : null;
    if (plan.path) historyRequests++;
    else if (plan.reason === "complete_cache") historyCacheHits++;
    if (plan.reason === "retry_deferred") {
      historyFailures.set(market.symbolId, [candleHistory[market.symbolId].failure!, "history_retry_deferred"]);
      histories.set(market.symbolId, plan.cached);
      historyDecisions.push({ marketId: market.symbolId, reason: plan.reason, requested: false, receivedBars: 0, reusedBars: plan.cached.length });
      continue;
    }
    try {
      const incoming = raw === null ? [] : parseCoinApiBars(raw, now());
      const merged = mergeCoinApiHistory(plan.cached, incoming);
      histories.set(market.symbolId, merged);
      const incomplete = !hasCompleteCoinApiHistory(merged, now());
      candleHistory[market.symbolId] = { marketId: market.symbolId,
        fetchedAt: plan.path ? new Date(now()).toISOString() : candleHistory[market.symbolId].fetchedAt,
        bars: merged,
        ...(incomplete ? { failure: "incomplete_candle_history" as const,
          retryAfter: new Date(now() + COINAPI_HISTORY_POLICY.incompleteRetryMs).toISOString() } : {}) };
      if (incomplete) historyFailures.set(market.symbolId, ["incomplete_candle_history"]);
      historyDecisions.push({ marketId: market.symbolId, reason: plan.reason, requested: Boolean(plan.path),
        receivedBars: incoming.length, reusedBars: plan.cached.length });
    } catch {
      historyFailures.set(market.symbolId, ["conflicting_or_invalid_candle_history"]);
      candleHistory[market.symbolId] = { marketId: market.symbolId, fetchedAt: new Date(now()).toISOString(),
        bars: [], failure: "conflicting_or_invalid_candle_history",
        retryAfter: new Date(now() + COINAPI_HISTORY_POLICY.incompleteRetryMs).toISOString() };
      historyDecisions.push({ marketId: market.symbolId, reason: "invalid_history", requested: Boolean(plan.path), receivedBars: 0, reusedBars: 0 });
    }
  }
  const decisionTime = now(), decisionAt = new Date(decisionTime).toISOString();
  const quotes = parsePilotQuotes(rawQuotes, catalog, decisionTime);
  const byId = new Map(quotes.map(q => [q.marketId, q]));
  const evidence = queue.selected.flatMap(market => {
    const quote = byId.get(market.symbolId)!;
    return quote.trade ? [coinApiResearchEvidence({ market, trade: quote.trade, book: quote.book,
      bars: histories.get(market.symbolId) ?? [], decisionAt })] : [];
  });
  const research = rankCryptoLiveResearch(evidence);
  const marketById = new Map(catalog.map(m => [m.symbolId, m]));
  const measured = new Set(research.decisions.map(d => d.identity.marketId));
  const selected = new Set(queue.selected.map(m => m.symbolId));
  const coverage = quotes.map(q => ({ marketId: q.marketId,
    status: !evaluateCryptoAssetPolicy(marketById.get(q.marketId)!.base).allowed
      ? "asset_policy_excluded" : !selected.has(q.marketId) ? "quote_only_not_deep_scored"
        : !measured.has(q.marketId) ? "selected_missing_trade" : "evaluated",
    failures: [...q.failures, ...(historyFailures.get(q.marketId) ?? [])],
  }));
  const state: PilotState = { catalog, catalogAt, cursor: queue.cursor,
    priorityMarket: nextPriority(quotes, previous?.previousQuotes ?? [], catalog), previousQuotes: quotes,
    candleHistory: boundCoinApiHistory(candleHistory, new Set(catalog.map(m => m.symbolId))) };
  return { state, frame: {
    version: COINAPI_PILOT.version, provider: "coinapi" as const, authority: "research_only" as const,
    dataContractVersion: "coinapi-research-data-v2" as const,
    decisionAt, catalogAt, intervalSeconds: COINAPI_PILOT.intervalSeconds,
    selectionPolicy: COINAPI_PILOT.selection, selectedMarkets: [...selected],
    coverage, quotes, evidence, research, usage: client.usage(),
    history: { version: COINAPI_HISTORY_POLICY.version, cacheHits: historyCacheHits, requests: historyRequests,
      skippedRequests: queue.selected.length - historyCacheHits - historyRequests,
      decisions: historyDecisions,
      invalidMarkets: [...historyFailures.keys()], retainedMarkets: Object.keys(state.candleHistory ?? {}).length },
    summary: { nativeUsdMarkets: catalog.length, freshAlignedQuotes: quotes.filter(q => !q.failures.length).length,
      selectedForDeepResearch: selected.size, scored: research.scored,
      selectedUnavailable: selected.size - research.scored },
    executionAuthorized: false as const, publicRankingChanged: false as const,
    costs: null, profitabilityEstablished: false as const,
  } };
}

export type PilotFrame = Awaited<ReturnType<typeof collectCoinApiPilot>>["frame"];

/** Read-time freshness never advances provider clocks, even when the cron or budget stops. */
export function pilotFreshness(frame: PilotFrame | null, now: number) {
  const ageMs = frame ? now - Date.parse(frame.decisionAt) : NaN;
  const fresh = Number.isFinite(ageMs) && ageMs >= -2_000 && ageMs <= 90_000;
  return { fresh, ageSeconds: Number.isFinite(ageMs) ? Math.max(0, ageMs / 1_000) : null,
    freshTradeCount: frame?.quotes.filter(q => q.trade && now - Date.parse(q.trade.asOf) <= 30_000 &&
      Date.parse(q.trade.asOf) <= now + 2_000).length ?? 0,
    freshAlignedQuoteCount: frame?.quotes.filter(q => !q.failures.length && q.trade && q.book &&
      now - Date.parse(q.trade.asOf) <= 30_000 && now - Date.parse(q.book.asOf) <= 15_000 &&
      Date.parse(q.trade.asOf) <= now + 2_000 && Date.parse(q.book.asOf) <= now + 2_000).length ?? 0 };
}
