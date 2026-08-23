import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner resolves this source module directly.
import { BOT_DECISION_VERSION, evaluateBotEntry, getBotEntryControlSkipReason, isBotCandidateReady } from "./decision.ts";

const strongCandidate = {
  ticker: "AIAI",
  price: 6.62,
  change: 46.14,
  changeFromOpenPercent: 38.2,
  relativeVolume: 25,
  signalState: "Strong Momentum",
  opportunityScore: 89,
  riskTags: ["Extreme Momentum", "High Volatility"],
  eligibility: { eligible: true, reasons: [] },
  visibilityState: "canonical",
  tradeFramework: {
    upsideMax: 32.99,
    downsideRisk: 10.88,
    entryQuality: 75,
    atr14: 0.72,
  },
  explosionAssessment: {
    score: 77,
    continuationConfirmed: true,
    scenarioBands: null,
  },
};

test("uses one bounded score contract for standard and continuation paths", () => {
  const standard = evaluateBotEntry(strongCandidate, "standard");
  const continuation = evaluateBotEntry(strongCandidate, "continuation");

  assert.equal(standard.version, BOT_DECISION_VERSION);
  assert.equal(standard.qualified, true);
  assert.equal(continuation.qualified, true);
  assert.equal(standard.score, continuation.score);
  assert.ok((standard.score ?? -1) >= 0 && (standard.score ?? 101) <= 100);
});

test("rejects a clean R:R watch name with weak observed opportunity", () => {
  const result = evaluateBotEntry(
    {
      ...strongCandidate,
      ticker: "TAOX",
      change: 3.1,
      changeFromOpenPercent: 1.31,
      relativeVolume: 2.5,
      signalState: "Watch",
      opportunityScore: 31,
      riskTags: [],
      tradeFramework: {
        upsideMax: 13.13,
        downsideRisk: 2.59,
        entryQuality: 100,
        atr14: 0.2,
      },
      explosionAssessment: {
        score: 42,
        continuationConfirmed: false,
        scenarioBands: null,
      },
    },
    "standard",
  );

  assert.equal(result.qualified, false);
  assert.match(result.hardFailures.join(" "), /opportunity score is below 55/i);
  assert.match(result.hardFailures.join(" "), /not strongly confirmed/i);
});

test("rejects a full-day mover that is currently below the session open", () => {
  const result = evaluateBotEntry(
    { ...strongCandidate, changeFromOpenPercent: -4.2 },
    "continuation",
  );
  assert.equal(result.qualified, false);
  assert.match(result.hardFailures.join(" "), /below its session open/i);
});

test("uses measured price-discovery scenarios without manufacturing a target", () => {
  const result = evaluateBotEntry(
    {
      ...strongCandidate,
      visibilityState: "verified_price_discovery",
      eligibility: {
        eligible: false,
        reasons: ["Live price is inconsistent with recent adjusted history."],
      },
      tradeFramework: {
        upsideMax: null,
        downsideRisk: null,
        entryQuality: 80,
        atr14: 0.5,
      },
      explosionAssessment: {
        score: 90,
        continuationConfirmed: true,
        scenarioBands: {
          expansion: { min: 20, max: 30 },
          structuralRisk: null,
        },
      },
    },
    "price_discovery",
  );

  assert.equal(result.qualified, true);
  assert.equal(result.continuationCapacityPercent, 25);
  assert.ok((result.effectiveRr ?? 0) >= 1.5);
});

test("fails closed when price-discovery continuation capacity is unavailable", () => {
  const result = evaluateBotEntry(
    {
      ...strongCandidate,
      visibilityState: "verified_price_discovery",
      eligibility: { eligible: false, reasons: [] },
      tradeFramework: {
        upsideMax: null,
        downsideRisk: null,
        entryQuality: 80,
        atr14: 0.5,
      },
      explosionAssessment: {
        score: 90,
        continuationConfirmed: true,
        scenarioBands: null,
      },
    },
    "price_discovery",
  );

  assert.equal(result.qualified, false);
  assert.match(result.hardFailures.join(" "), /capacity cannot be measured/i);
});

test("requires persistence unless a qualified candidate clears the fast floor", () => {
  const decision = evaluateBotEntry(strongCandidate, "continuation");
  assert.equal(decision.qualified, true);
  assert.equal(decision.fastEntryEligible, false);
  assert.equal(isBotCandidateReady(decision, false), false);
  assert.equal(isBotCandidateReady(decision, true), true);
  assert.equal(
    isBotCandidateReady({ ...decision, fastEntryEligible: true }, false),
    true,
  );
});

test("entry controls stop purchases without disabling position management", () => {
  const base = {
    entriesEnabled: true,
    entryWindowOpen: true,
    decisionAuditAvailable: true,
    orphanedAlpacaPositionCount: 0,
    openPositionCount: 0,
    maxConcurrentPositions: 6,
    recentEntryCount: 0,
    maxRecentEntries: 3,
    minutesSinceLatestEntry: Number.POSITIVE_INFINITY,
    minimumMinutesBetweenEntries: 30,
  };
  assert.equal(getBotEntryControlSkipReason(base), null);
  assert.equal(
    getBotEntryControlSkipReason({ ...base, entriesEnabled: false }),
    "new_entries_disabled",
  );
  assert.equal(
    getBotEntryControlSkipReason({
      ...base,
      entriesEnabled: false,
      entryWindowOpen: false,
    }),
    "outside_session",
  );
  assert.equal(
    getBotEntryControlSkipReason({
      ...base,
      entriesEnabled: false,
      decisionAuditAvailable: false,
    }),
    "decision_audit_unavailable",
  );
  assert.equal(
    getBotEntryControlSkipReason({
      ...base,
      orphanedAlpacaPositionCount: 1,
    }),
    "alpaca_position_reconciliation_required",
  );
  assert.equal(
    getBotEntryControlSkipReason({ ...base, recentEntryCount: 3 }),
    "rolling_24h_entry_limit",
  );
  assert.equal(
    getBotEntryControlSkipReason({ ...base, minutesSinceLatestEntry: 12 }),
    "entry_cooldown",
  );
});
