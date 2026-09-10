// @ts-expect-error Node's strip-types runner requires source extensions.
import { ACTIVE_MARKET_DATA_MAX_AGE_SECONDS, getMarketDataAgeMs, isActiveMarketTimestampUsable } from "../market-data-time.ts";

type SourceRow = {
  ticker: string;
  market_as_of: string | null;
  quote_as_of: string | null;
  trade_as_of: string | null;
};

/** Read-only diagnostics. Does not change the collector, freshness limits or scores. */
export function describeProxMicrostructureCoverage(rows: SourceRow[], now = Date.now()) {
  const clock = (value: string | null) => {
    const age = getMarketDataAgeMs(value, now);
    return {
      providerAsOf: value,
      ageSeconds: age === null ? null : Number((age / 1_000).toFixed(1)),
      usable: isActiveMarketTimestampUsable(value, now),
      state: age === null ? "unavailable" : isActiveMarketTimestampUsable(value, now)
        ? "within_existing_source_window" : age < 0 ? "future_timestamp" : "stale",
    };
  };
  const sources = rows.map(row => ({
    ticker: row.ticker,
    quote: clock(row.quote_as_of),
    trade: clock(row.trade_as_of),
    combined: clock(row.market_as_of),
  }));
  const incomplete = sources.filter(source => !source.quote.usable || !source.trade.usable);
  return {
    version: "prox-microstructure-coverage-v1",
    sourceWindowSeconds: ACTIVE_MARKET_DATA_MAX_AGE_SECONDS,
    coverageState: sources.length === 0 ? "unavailable" : incomplete.length ? "partial" : "complete",
    freshQuoteCount: sources.filter(source => source.quote.usable).length,
    freshTradeCount: sources.filter(source => source.trade.usable).length,
    freshQuoteAndTradeCount: sources.filter(source => source.quote.usable && source.trade.usable).length,
    sourceIssues: incomplete,
    interpretation: "Collector health permits partial coverage. A fresh combined clock does not refresh the other source. Missing tape means no qualifying consolidated trade was returned inside the same five-minute evidence window; it is not proof of a provider outage or a halt.",
    providerRequests: 0,
  };
}
