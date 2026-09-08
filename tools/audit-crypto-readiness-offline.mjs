/**
 * Read-only, synthetic audit. No environment credentials, network, or database.
 * Run: node --experimental-strip-types tools/audit-crypto-readiness-offline.mjs
 * Regression recheck after the repair. Original counterexamples remain in the
 * dated audit report; this tool no longer executes the retired bad writers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseCoinApiBars } from "../lib/crypto/coinapi-normalize.ts";
import { pilotFreshness } from "../lib/crypto/coinapi-pilot.ts";
import { measureCryptoResearchOutcome } from "../lib/crypto/live-research-evaluation.ts";
import { legacyCryptoOutcomeQuarantine } from "../lib/crypto/outcome-integrity.ts";

const route = readFileSync(new URL("../app/api/crypto/prox-sensor/route.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(ts.isFunctionDeclaration).map(node => node.name?.text);
for (const retired of ["persistOutcomePrices","persistDiscoveryOutcomePrices","loadDueOutcomes","loadDueDiscoveryOutcomes"]) {
  assert.equal(functions.includes(retired),false,`${retired} must not return to the collection route`);
}
assert.match(route,/legacyCryptoOutcomeQuarantine\(\)/);
const diagnostics = readFileSync(new URL("../app/api/crypto-outcome-diagnostics/route.ts",import.meta.url),"utf8");
assert.doesNotMatch(diagnostics,/buildFreshCryptoOpportunityFeedState|resolvedPriceViaFix|currentPriceBySymbol/);
assert.match(diagnostics,/backfillWithCurrentPricesAllowed: false/);

const origin = Date.parse("2026-09-02T12:00:00Z");
const at = seconds => new Date(origin + seconds * 1_000).toISOString();
const identity = { provider: "coinapi", marketId: "COINBASE_SPOT_TEST_USD", base: "TEST", quote: "USD" };
const input = { identity, decisionAt: at(0), trade: { price: 10, asOf: at(-1) },
  book: { bid: 9.99, ask: 10.01, asOf: at(-1) }, candles: [], marketState: "normal" };
const costs = { version: "synthetic-audit-only", feeBpsPerSide: 10, slippageBpsPerSide: 5 };
const books = [
  { identity, bid: 12, ask: 12.01, asOf: at(900), receivedAt: at(901) },
  { identity, bid: 11, ask: 11.01, asOf: at(3_600), receivedAt: at(3_601) },
  { identity, bid: 20, ask: 20.01, asOf: at(14_400), receivedAt: at(14_401) },
];
const measure = (horizonSeconds, history) => measureCryptoResearchOutcome({
  input, books: history, costs, measuredAt: at(14_500), horizonSeconds,
});
const correct15m = measure(900, books);
const correct1h = measure(3_600, books);
const missing15m = measure(900, [books[2]]);
assert.equal(correct15m.exitAsOf, at(900));
assert.equal(correct1h.exitAsOf, at(3_600));
assert.equal(missing15m.netReturnPercent, null);

const rawBar = { time_period_start: at(0), time_period_end: at(60),
  time_open: at(1), time_close: at(59), price_open: 10, price_high: 12,
  price_low: 9, price_close: 10, volume_traded: 100 };
const conflictingBar = { ...rawBar, price_close: 11 };
assert.throws(()=>parseCoinApiBars([rawBar, conflictingBar], origin + 120_000),/conflicting/);
assert.throws(()=>parseCoinApiBars([conflictingBar, rawBar], origin + 120_000),/conflicting/);
const frame = { decisionAt: at(0), quotes: [{ marketId: identity.marketId,
  trade: { price: 10, asOf: at(0) }, book: { bid: 9.99, ask: 10.01, asOf: at(0) }, failures: [] }] };

// Published PAYG marginal rates, checked 2026-09-02. Not an account invoice.
function dailyDollars(credits) {
  assert.ok(Number.isInteger(credits) && credits >= 0 && credits <= 10_000);
  return Math.min(credits, 1_000) * 0.00526 +
    Math.min(Math.max(credits - 1_000, 0), 2_000) * 0.00263 +
    Math.max(credits - 3_000, 0) * 0.00173;
}
const money = value => Number(value.toFixed(2));
const scenarios = [
  ["Capped pilot: about 100 active minutes/day", 300],
  ["24/7 batch quotes only, no deep research", 1_441],
  ["24/7 batch quotes/minute; two deep histories every 5 minutes (not implemented)", 2_017],
  ["24/7 current cycle: batch quotes + two deep histories/minute", 4_321],
].map(([name, credits]) => ({ name, creditsPerDay: credits,
  dollarsPerDay: money(dailyDollars(credits)), hypothetical30DayDollars: money(dailyDollars(credits) * 30),
  daysForExisting2493: money(24.93 / dailyDollars(credits)),
  daysForProposed7493: money(74.93 / dailyDollars(credits)),
}));

console.log(JSON.stringify({
  evidenceType: "synthetic_offline_repair_regression_not_market_performance",
  providerRequestsMade: 0, databaseWritesMade: 0,
  findings: {
    lateCurrentPriceWritersRemoved: true,
    legacyHistory: legacyCryptoOutcomeQuarantine(),
    conflictingCandlesRejectedInEitherOrder: true,
    researchPublicationVersusQuoteFreshness: [0, 16, 60, 91].map(seconds => ({
      secondsAfterCollection: seconds, ...pilotFreshness(frame, origin + seconds * 1_000),
    })),
  },
  independentOutcomeHelper: { correct15m, correct1h, missing15m },
  costAssumptions: "PAYG, 1 credit/request, sole use of key, daily tiers; excludes taxes/hosting. No activation approved.",
  scenarios,
  current900CreditPilotAcrossThreeCappedDaysDollars: money(dailyDollars(300) * 3),
  measuredProductionProfitability: null,
}, null, 2));
