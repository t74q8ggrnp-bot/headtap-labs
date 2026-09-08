/** Offline measurement only. No network, public-feed, scoring or execution imports. */
export const STREAM_MEASUREMENT_VERSION = "coinapi-stream-measurement-v1";
export const STREAM_PRICE_REFERENCE = {
  checkedOn: "2026-09-03",
  url: "https://www.coinapi.io/products/market-data-api/pricing",
  tier1UsdPerGiB: 1,
  tier2UsdPerMiB: 0.0625,
} as const;

export type StreamTestPlan = {
  marketIds: string[];
  durationSeconds: number;
  maxPayloadBytes: number;
  quoteIntervalMs: number;
};

export function validateStreamTestPlan(plan: StreamTestPlan): StreamTestPlan {
  if (!Array.isArray(plan.marketIds) || plan.marketIds.length < 1 || plan.marketIds.length > 20 ||
      new Set(plan.marketIds).size !== plan.marketIds.length || plan.marketIds.some(id =>
        !/^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9][A-Z0-9.-]{0,19}_USD$/.test(id))) {
    throw new Error("Use 1–20 distinct, exact native-USD spot market IDs from the existing venues.");
  }
  if (!Number.isSafeInteger(plan.durationSeconds) || plan.durationSeconds < 30 || plan.durationSeconds > 300 ||
      !Number.isSafeInteger(plan.maxPayloadBytes) || plan.maxPayloadBytes < 1024 || plan.maxPayloadBytes > 8 * 1024 ** 2 ||
      !Number.isSafeInteger(plan.quoteIntervalMs) || plan.quoteIntervalMs < 1000 || plan.quoteIntervalMs > 60_000) {
    throw new Error("Use a 30–300 second test, at most 8 MiB, and quotes no faster than once per second.");
  }
  return structuredClone(plan);
}

export function streamSubscription(plan: StreamTestPlan) {
  const checked = validateStreamTestPlan(plan);
  return {
    type: "hello", heartbeat: true,
    subscribe_data_type: ["quote", "trade"],
    // '$' is important: without it CoinAPI uses prefix matching.
    subscribe_filter_symbol_id: checked.marketIds.map(id => `${id}$`),
    subscribe_update_limit_ms_quote: checked.quoteIntervalMs,
  };
}

type Stamp = { raw: string; ms: number; order: string };
function stamp(value: unknown): Stamp | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0 || new Date(ms).toISOString().slice(0, 19) !== match[1]) return null;
  return { raw: value, ms, order: `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z` };
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
type Tick = { exchange: Stamp; coinapi: Stamp; receivedAt: number; price: number };
type Quote = { exchange: Stamp; coinapi: Stamp; receivedAt: number; bid: number; ask: number };
type Candle = {
  minute: number; open: number; high: number; low: number; close: number; volume: number;
  first: string; last: string; lastSequence: number; observedTrades: number;
};
type MarketSample = {
  trades: number; quotes: number; duplicateTrades: number; sequenceRegressions: number;
  tradeSequenceGaps: number; quoteSequenceJumps: number; outOfOrderTimes: number;
  staleAtReceipt: number; invalid: number; latestTrade: Tick | null; latestQuote: Quote | null;
  lastTradeSequence: number | null; lastQuoteSequence: number | null;
  tradeIds: Set<string>; candles: Map<number, Candle>;
};

export function createStreamMeasurement(input: StreamTestPlan, startedAt: number) {
  const plan = validateStreamTestPlan(input);
  if (!Number.isFinite(startedAt) || startedAt <= 0) throw new Error("Invalid measurement start.");
  const samples = new Map<string, MarketSample>(plan.marketIds.map(id => [id, {
    trades: 0, quotes: 0, duplicateTrades: 0, sequenceRegressions: 0, tradeSequenceGaps: 0,
    quoteSequenceJumps: 0, outOfOrderTimes: 0, staleAtReceipt: 0, invalid: 0,
    latestTrade: null, latestQuote: null, lastTradeSequence: null, lastQuoteSequence: null,
    tradeIds: new Set(), candles: new Map(),
  }]));
  let payloadBytes = 0, tier1Bytes = 0, otherBytes = 0, messages = 0;
  let fatalReason: string | null = null;

  function record(raw: string, receivedAt: number): string | null {
    if (fatalReason) return fatalReason;
    const bytes = new TextEncoder().encode(raw).byteLength;
    payloadBytes += bytes;
    messages++;
    // Include the crossing message in usage. This is a receive-side stop, NOT a provider billing cap.
    if (payloadBytes >= plan.maxPayloadBytes) fatalReason = "payload_limit";
    if (!Number.isFinite(receivedAt) || receivedAt < startedAt) return fatalReason = "invalid_receipt_clock";
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      row = parsed as Record<string, unknown>;
    } catch { otherBytes += bytes; return fatalReason = "malformed_message"; }
    if (row.type === "trade" || row.type === "quote") tier1Bytes += bytes;
    else otherBytes += bytes;
    if (row.type === "heartbeat") return fatalReason;
    if (row.type === "error") return fatalReason = "provider_error"; // Do not echo provider messages/keys.
    if (row.type !== "trade" && row.type !== "quote") return fatalReason = "unexpected_data_type";
    const sample = samples.get(String(row.symbol_id));
    if (!sample) return fatalReason = "unexpected_market";
    const exchange = stamp(row.time_exchange), coinapi = stamp(row.time_coinapi);
    if (!exchange || !coinapi || exchange.ms > receivedAt + 2000 || coinapi.ms > receivedAt + 2000 ||
        exchange.ms > coinapi.ms + 2000 || !Number.isSafeInteger(row.sequence) || Number(row.sequence) < 0) {
      sample.invalid++; return fatalReason;
    }
    const sequence = Number(row.sequence);
    const isTrade = row.type === "trade";
    if (isTrade ? !positive(row.price) || !positive(row.size) || typeof row.uuid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.uuid)
      : !positive(row.bid_price) || !positive(row.ask_price) || row.ask_price < row.bid_price) {
      sample.invalid++; return fatalReason;
    }
    const previousSequence = isTrade ? sample.lastTradeSequence : sample.lastQuoteSequence;
    if (previousSequence !== null && sequence <= previousSequence) sample.sequenceRegressions++;
    if (previousSequence !== null && sequence > previousSequence + 1) {
      if (isTrade) sample.tradeSequenceGaps += sequence - previousSequence - 1;
      else sample.quoteSequenceJumps++; // Quote throttle can legitimately omit intermediate updates.
    }
    const previous = isTrade ? sample.latestTrade : sample.latestQuote;
    if (previous && exchange.order < previous.exchange.order) sample.outOfOrderTimes++;
    if (receivedAt - exchange.ms > (isTrade ? 30_000 : 15_000)) sample.staleAtReceipt++;
    if (isTrade) {
      const tradeId = String(row.uuid).toLowerCase();
      if (sample.tradeIds.has(tradeId)) { sample.duplicateTrades++; return fatalReason; }
      sample.tradeIds.add(tradeId);
      sample.trades++;
      sample.lastTradeSequence = Math.max(previousSequence ?? -1, sequence);
      const price = Number(row.price), size = Number(row.size);
      if (!previous || exchange.order > previous.exchange.order ||
          (exchange.order === previous.exchange.order && sequence > (previousSequence ?? -1))) {
        sample.latestTrade = { exchange, coinapi, receivedAt, price };
      }
      const minute = Math.floor(exchange.ms / 60_000) * 60_000;
      // Do not manufacture historical candles from a late price, or fill empty minutes.
      if (minute < Math.floor(startedAt / 60_000) * 60_000) return fatalReason;
      const bar = sample.candles.get(minute);
      if (!bar) sample.candles.set(minute, { minute, open: price, high: price, low: price,
        close: price, volume: size, first: exchange.order, last: exchange.order, lastSequence: sequence, observedTrades: 1 });
      else {
        bar.high = Math.max(bar.high, price); bar.low = Math.min(bar.low, price);
        bar.volume += size; bar.observedTrades++;
        if (exchange.order < bar.first) { bar.first = exchange.order; bar.open = price; }
        if (exchange.order > bar.last || (exchange.order === bar.last && sequence > bar.lastSequence)) {
          bar.last = exchange.order; bar.lastSequence = sequence; bar.close = price;
        }
      }
    } else {
      sample.quotes++;
      sample.lastQuoteSequence = Math.max(previousSequence ?? -1, sequence);
      if (!previous || exchange.order > previous.exchange.order ||
          (exchange.order === previous.exchange.order && sequence > (previousSequence ?? -1))) {
        sample.latestQuote = { exchange, coinapi, receivedAt, bid: Number(row.bid_price), ask: Number(row.ask_price) };
      }
    }
    return fatalReason;
  }

  function report(endedAt: number, stopReason: string) {
    const elapsedSeconds = Math.max(0, (endedAt - startedAt) / 1000);
    const trafficProjectionAllowed = elapsedSeconds >= 30 && tier1Bytes > 0 &&
      !fatalReason && stopReason === "duration_limit";
    const sampleRows = [...samples].map(([marketId, sample]) => {
      const { tradeIds: _ids, candles, latestTrade, latestQuote, ...counts } = sample;
      void _ids; // Never export the in-memory deduplication set.
      const tradeAgeMs = latestTrade ? endedAt - latestTrade.exchange.ms : null;
      const quoteAgeMs = latestQuote ? endedAt - latestQuote.exchange.ms : null;
      const alignmentMs = latestTrade && latestQuote ? Math.abs(latestTrade.exchange.ms - latestQuote.exchange.ms) : null;
      const bars = [...candles.values()].sort((a, b) => a.minute - b.minute);
      return { marketId, ...counts,
        trade: latestTrade, quote: latestQuote, tradeAgeMs, quoteAgeMs, alignmentMs,
        freshAlignedAtEnd: tradeAgeMs !== null && quoteAgeMs !== null && alignmentMs !== null &&
          tradeAgeMs >= -2000 && tradeAgeMs <= 30_000 && quoteAgeMs >= -2000 && quoteAgeMs <= 15_000 && alignmentMs <= 15_000,
        observedCandles: bars, candleCompletenessVerified: false,
        lastTradeMatchesObservedCandle: !!latestTrade && bars.at(-1)?.close === latestTrade.price,
      };
    });
    return {
      version: STREAM_MEASUREMENT_VERSION, scope: "selected_markets_transport_measurement_only",
      startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
      elapsedSeconds, stopReason: fatalReason ?? stopReason, plan,
      messages, payloadBytes, tier1Bytes, otherBytes,
      billing: {
        priceReference: STREAM_PRICE_REFERENCE,
        estimatedTier1PayloadUsd: tier1Bytes / 1024 ** 3 * STREAM_PRICE_REFERENCE.tier1UsdPerGiB,
        // Payload is not a billing receipt. Heartbeats, buffering and wire billing remain unverified.
        providerReportedUsd: null, providerReportedGiB: null, providerReceiptVerified: false,
        projected30DayTier1PayloadUsd: trafficProjectionAllowed
          ? tier1Bytes / elapsedSeconds * 86_400 * 30 / 1024 ** 3 * STREAM_PRICE_REFERENCE.tier1UsdPerGiB : null,
        hostingUsd: null, totalMonthlyUsd: null, accountWideSpendingCapVerified: false,
      },
      coverage: { requested: sampleRows.length, withTrades: sampleRows.filter(s => s.trades > 0).length,
        withQuotes: sampleRows.filter(s => s.quotes > 0).length,
        freshAlignedAtEnd: sampleRows.filter(s => s.freshAlignedAtEnd).length,
        wholeUniverseMeasured: false },
      samples: sampleRows, providerRestRequests: 0, reconnectAttempts: 0,
      publicFeedChanged: false, executionAuthorized: false, profitabilityEstablished: false,
    };
  }
  return { record, report };
}
