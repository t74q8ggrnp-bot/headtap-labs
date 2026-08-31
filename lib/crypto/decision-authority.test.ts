import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { scoreCryptoOpportunity } from "./opportunity-engine.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { applyCryptoDecisionAuthority, rankCryptoDecisionFrame } from "./decision-authority.ts";

const base = scoreCryptoOpportunity({
  productId: "TEST-USD",
  symbol: "TEST",
  open: 10,
  high: 12,
  low: 9,
  last: 11.5,
  volume24h: 1_000_000,
  volume30d: 15_000_000,
})!;

const freshPacket = {
  packetVersion: "crypto-prox-v2" as const,
  mode: "bounded_authority" as const,
  productId: base.productId,
  symbol: base.symbol,
  computedAt: "2026-08-23T14:00:00.000Z",
  fresh: true,
  barCount: 60,
  state: "expanding" as const,
  marketConfirmation: 75,
  proposedScoreAdjustment: 5,
  shadowOpportunityScore: base.baseOpportunityScore + 5,
  features: {
    velocity1mPercent: 0.2,
    velocity5mPercent: 1,
    velocity15mPercent: 2,
    volumeAcceleration: 1.5,
    priceVsVwapPercent: 1,
    spreadPercent: 0.2,
    windowHighPrice: 11.6,
    pullbackFromWindowHighPercent: 0.9,
    minutesSinceWindowHigh: 1,
    averageBarRangePercent: 0.4,
    realizedVolatilityPercent: 0.2,
    activeBarRatioPercent: 100,
    btcRelativeStrength15mPercent: 1,
    peakFailureThresholdPercent: 5,
    peakFailureConfirmed: false,
  },
  supportFlags: ["volume_accelerating"],
  riskFlags: [],
  trace: [],
};

const discovery = {
  version: "crypto-multivenue-discovery-v2" as const,
  mode: "confirmation" as const,
  authority: "bounded_confirmation" as const,
  generatedAt: "2026-08-23T14:00:00.000Z",
  candidates: [{
    assetId: "TEST",
    symbol: "TEST",
    rank: 1,
    entryPriceUsd: 11.5,
    observedMovePercent: 15,
    dollarVolume: 20_000_000,
    venueCount: 2,
    venues: ["coinbase" as const, "crypto_com" as const],
    quoteCurrencies: ["USD"],
    confirmingVenues: 2,
    crossVenueDispersionPercent: 1,
    proposedOpportunityScore: 80,
    attention: null,
    supportFlags: ["multi_venue_observed"],
    riskFlags: [],
    scoreBreakdown: {
      momentum: 80,
      liquidity: 80,
      crossVenue: 80,
      venueBreadth: 67,
      attention: 0,
    },
    markets: [{
      venue: "coinbase" as const,
      productId: "TEST-USD",
      quoteCurrency: "USD",
      sourceWindow: "rolling_24h" as const,
      priceUsd: 11.5,
      observedMovePercent: 15,
      dollarVolume: 12_000_000,
      spreadPercent: 0.2,
      tradeCount: null,
    }, {
      venue: "crypto_com" as const,
      productId: "TEST_USD",
      quoteCurrency: "USD",
      sourceWindow: "rolling_24h" as const,
      priceUsd: 11.48,
      observedMovePercent: 14.5,
      dollarVolume: 8_000_000,
      spreadPercent: 0.25,
      tradeCount: null,
    }],
  }],
  diagnostics: {
    configuredVenues: 3,
    healthyVenues: 3,
    venueMarkets: { coinbase: 1, kraken: 0, crypto_com: 1 },
    quoteMarkets: { USD: 2 },
    supportedPairs: 2,
    observedAssets: 1,
    candidateAssets: 1,
    attentionSourceHealthy: true,
    attentionItems: 0,
    providerFailures: 0,
    providerStatus: [],
  },
};

test("requires both base discovery and fresh ProX evidence to qualify", () => {
  const [qualified] = applyCryptoDecisionAuthority({
    opportunities: [{ ...base, proxIntelligence: freshPacket }],
    discovery,
  });
  assert.equal(qualified.eligible, true);
  assert.equal(qualified.decisionState, "qualified");
  assert.equal(qualified.liveDataFresh, true);

  const [stale] = applyCryptoDecisionAuthority({
    opportunities: [{
      ...base,
      proxIntelligence: {
        ...freshPacket,
        fresh: false,
        state: "stale",
        proposedScoreAdjustment: 0,
      },
    }],
    discovery,
  });
  assert.equal(stale.eligible, false);
  assert.notEqual(stale.decisionState, "qualified");
  assert.ok(stale.authorityFlags.includes("live_tape_stale"));
});

test("publishes exactly one hero and no more than five qualified contenders", () => {
  const opportunities = Array.from({ length: 8 }, (_, index) => ({
    ...base,
    productId: `TEST${index}-USD`,
    symbol: `TEST${index}`,
    opportunityScore: 90 - index,
    eligible: true,
    radarEligible: false,
    decisionState: "qualified" as const,
  }));
  const frame = rankCryptoDecisionFrame(opportunities);
  assert.equal(frame.hero?.symbol, "TEST0");
  assert.equal(frame.developingLeader, null);
  assert.equal(frame.contenders.length, 5);
  assert.deepEqual(
    frame.contenders.map((item) => item.symbol),
    ["TEST1", "TEST2", "TEST3", "TEST4", "TEST5"],
  );
});

test("publishes the strongest backend-ranked radar name as developing, not qualified", () => {
  const opportunities = Array.from({ length: 4 }, (_, index) => ({
    ...base,
    productId: `RADAR${index}-USD`,
    symbol: `RADAR${index}`,
    opportunityScore: 70 - index,
    eligible: false,
    radarEligible: true,
    decisionState: "radar" as const,
  }));
  const frame = rankCryptoDecisionFrame(opportunities);
  assert.equal(frame.hero, null);
  assert.equal(frame.developingLeader?.symbol, "RADAR0");
  assert.equal(frame.developingLeader?.eligible, false);
  assert.deepEqual(
    frame.radar.map((item) => item.symbol),
    ["RADAR1", "RADAR2", "RADAR3"],
  );
  assert.equal(frame.radarProducts, 4);
});
