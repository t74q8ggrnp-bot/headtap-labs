// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_AGENT_MARKET_TIMING_VERSION, type HtAgentMarketTimingEvidence, type HtAgentProviderClock } from "./contracts.ts";

/** Two independent provider clocks: a new print never refreshes an old NBBO. */
export function evaluateHtAgentMarketTiming(
  priceTimestamp: unknown,
  quoteTimestamp: unknown,
  nowMs: number,
  maxAgeSeconds: number,
) {
  const validNow = Number.isFinite(nowMs);
  const validLimit = Number.isFinite(maxAgeSeconds) && maxAgeSeconds >= 0;
  const clock = (value: unknown): HtAgentProviderClock => {
    const providerTimestamp = typeof value === "string" && value.trim() ? value : null;
    const parsed = providerTimestamp === null ? NaN : Date.parse(providerTimestamp);
    const ageSeconds = validNow && Number.isFinite(parsed) ? (nowMs - parsed) / 1000 : null;
    return {
      providerTimestamp,
      ageSeconds,
      status: ageSeconds === null || !validLimit ? "unavailable"
        : ageSeconds < 0 ? "future" : ageSeconds <= maxAgeSeconds ? "fresh" : "stale",
    };
  };
  const evidence: HtAgentMarketTimingEvidence = {
    version: HT_AGENT_MARKET_TIMING_VERSION,
    evaluatedAt: validNow ? new Date(nowMs).toISOString() : null,
    maxAgeSeconds,
    price: clock(priceTimestamp),
    nbbo: clock(quoteTimestamp),
  };
  const available = evidence.price.status !== "unavailable" && evidence.nbbo.status !== "unavailable";
  return {
    evidence,
    available,
    fresh: evidence.price.status === "fresh" && evidence.nbbo.status === "fresh",
    observedAgeSeconds: available
      ? Number(Math.max(evidence.price.ageSeconds!, evidence.nbbo.ageSeconds!).toFixed(1))
      : null,
  };
}
