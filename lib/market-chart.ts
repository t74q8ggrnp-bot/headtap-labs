export type MarketChartAsset = "stock" | "crypto";

export type MarketChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketChartSummary = {
  open: number;
  high: number;
  low: number;
  close: number;
  changePercent: number;
};

export type MarketChartDisplayQuote = {
  price: number;
  changePercent: number | null;
  asOf: string;
  live: boolean;
  source: "massive_polygon_last_trade" | "massive_polygon_snapshot" | "massive_crypto_trade" | "massive_crypto_aggregate" | "coinbase_crypto_trade" | "coinbase_crypto_aggregate";
  changeBasis?: "previous_close" | "24h_reference" | "chart_open";
  priceKind?: "trade" | "minute_aggregate";
  frameId?: string;
  frameVersion?: "stock-display-frame-v1";
  frameBucket?: number;
  frameCoordination?: "database" | "instance_fallback";
  frameCoordinationIssue?: "not_configured" | "rpc_error" | "invalid_rpc_response" | "transport_error";
};

export type MarketChartResponse = {
  success: true;
  asset: MarketChartAsset;
  symbol: string;
  productId?: string;
  windowLabel: string;
  sourceLabel: string;
  dataMode?: "real_time" | "delayed" | "unavailable";
  displayQuote?: MarketChartDisplayQuote;
  latestAt: string;
  summary: MarketChartSummary;
  bars: MarketChartBar[];
  intervalSeconds?: number;
};

export type MarketChartTimeSlot = {
  time: number;
  bar: MarketChartBar | null;
};

type MarketBarInput = {
  time?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
};

const round = (value: number, precision = 6) =>
  Number(value.toFixed(precision));

export function easternDateString(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export function normalizeMarketBars(
  inputs: MarketBarInput[],
  pricePrecision = 6,
): MarketChartBar[] {
  const unique = new Map<number, MarketChartBar>();

  for (const input of inputs) {
    const rawTime = Number(input.time);
    const time = rawTime > 10_000_000_000
      ? Math.floor(rawTime / 1_000)
      : Math.floor(rawTime);
    const open = Number(input.open);
    const high = Number(input.high);
    const low = Number(input.low);
    const close = Number(input.close);
    const volume = Number(input.volume);

    const valid =
      Number.isFinite(time) &&
      time > 0 &&
      [open, high, low, close].every(
        (value) => Number.isFinite(value) && value > 0,
      ) &&
      Number.isFinite(volume) &&
      volume >= 0 &&
      high >= Math.max(open, close, low) &&
      low <= Math.min(open, close, high);

    if (!valid) continue;
    unique.set(time, {
      time,
      open: round(open, pricePrecision),
      high: round(high, pricePrecision),
      low: round(low, pricePrecision),
      close: round(close, pricePrecision),
      volume: round(volume, 2),
    });
  }

  return [...unique.values()].sort((left, right) => left.time - right.time);
}

export function selectLatestEasternSessionBars(
  bars: MarketChartBar[],
): MarketChartBar[] {
  const latest = bars.at(-1);
  if (!latest) return [];
  const sessionDate = easternDateString(latest.time * 1_000);
  return bars.filter(
    (bar) => easternDateString(bar.time * 1_000) === sessionDate,
  );
}

export function rollupMarketBars(
  bars: MarketChartBar[],
  bucketSeconds = 60,
): MarketChartBar[] {
  const buckets = new Map<number, MarketChartBar>();
  for (const bar of [...bars].sort((left, right) => left.time - right.time)) {
    const time = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, { ...bar, time });
      continue;
    }
    buckets.set(time, {
      time,
      open: existing.open,
      high: round(Math.max(existing.high, bar.high)),
      low: round(Math.min(existing.low, bar.low)),
      close: bar.close,
      volume: round(existing.volume + bar.volume, 2),
    });
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

export function mergeMarketBars(
  base: MarketChartBar[],
  replacements: MarketChartBar[],
): MarketChartBar[] {
  const merged = new Map(base.map((bar) => [bar.time, bar]));
  for (const bar of replacements) merged.set(bar.time, bar);
  return [...merged.values()].sort((left, right) => left.time - right.time);
}

/**
 * Fold one verified provider trade into the minute series used by the chart.
 * When the aggregate for that minute already exists, only its close/range is
 * advanced; volume is not added twice. If the provider has not published the
 * current aggregate yet, the single print is an honest provisional OHLC bar.
 */
export function mergeVerifiedTradeIntoBars(
  bars: MarketChartBar[],
  trade: { price: number; size: number | null; timestamp: string } | null,
  bucketSeconds = 60,
  pricePrecision = 6,
): MarketChartBar[] {
  if (!trade || !(trade.price > 0) || !(bucketSeconds > 0)) return bars;
  const timestampMs = Date.parse(trade.timestamp);
  if (!Number.isFinite(timestampMs)) return bars;
  const tradeTime = Math.floor(timestampMs / 1_000 / bucketSeconds) * bucketSeconds;
  const latest = bars.at(-1);
  if (latest && tradeTime < latest.time) return bars;

  const existing = bars.find((bar) => bar.time === tradeTime);
  const replacement: MarketChartBar = existing
    ? {
        ...existing,
        high: round(Math.max(existing.high, trade.price), pricePrecision),
        low: round(Math.min(existing.low, trade.price), pricePrecision),
        close: round(trade.price, pricePrecision),
      }
    : {
        time: tradeTime,
        open: round(trade.price, pricePrecision),
        high: round(trade.price, pricePrecision),
        low: round(trade.price, pricePrecision),
        close: round(trade.price, pricePrecision),
        volume: round(trade.size ?? 0, 2),
      };
  return mergeMarketBars(bars, [replacement]);
}

export function buildUniformMarketTimeSlots(
  bars: MarketChartBar[],
  bucketSeconds: number,
): MarketChartTimeSlot[] {
  if (bars.length === 0 || !Number.isFinite(bucketSeconds) || bucketSeconds <= 0) {
    return [];
  }

  const sorted = [...bars].sort((left, right) => left.time - right.time);
  const firstTime = Math.floor(sorted[0].time / bucketSeconds) * bucketSeconds;
  const lastTime = Math.floor(sorted.at(-1)!.time / bucketSeconds) * bucketSeconds;
  const slotCount = Math.floor((lastTime - firstTime) / bucketSeconds) + 1;

  // A stock session is at most 960 one-minute slots and the crypto window is
  // 288 five-minute slots. Guard against malformed provider spans before
  // allocating an unexpectedly large client-side axis.
  if (!Number.isSafeInteger(slotCount) || slotCount <= 0 || slotCount > 2_000) {
    return sorted.map((bar) => ({ time: bar.time, bar }));
  }

  const barsByTime = new Map<number, MarketChartBar>();
  for (const bar of sorted) {
    const time = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    barsByTime.set(time, time === bar.time ? bar : { ...bar, time });
  }

  return Array.from({ length: slotCount }, (_, index) => {
    const time = firstTime + index * bucketSeconds;
    return { time, bar: barsByTime.get(time) ?? null };
  });
}

export function summarizeMarketBars(
  bars: MarketChartBar[],
  pricePrecision = 6,
): MarketChartSummary | null {
  const first = bars[0];
  const latest = bars.at(-1);
  if (!first || !latest || first.open <= 0) return null;

  return {
    open: round(first.open, pricePrecision),
    high: round(Math.max(...bars.map((bar) => bar.high)), pricePrecision),
    low: round(Math.min(...bars.map((bar) => bar.low)), pricePrecision),
    close: round(latest.close, pricePrecision),
    changePercent: round(((latest.close - first.open) / first.open) * 100, 3),
  };
}
