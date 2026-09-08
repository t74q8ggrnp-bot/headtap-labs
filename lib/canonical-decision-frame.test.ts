import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS, findOpportunityInDecisionFrame, getDecisionFrameFreshness, getDecisionFrameMarketTimingFreshness } from "./canonical-decision-frame-policy.ts";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { getRetainedSessionIntegrity, presentCanonicalSessionRecord } from "./canonical-decision-frame-policy.ts";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { getLastCompletedStockSessionDate, stockHistoryLabel } from "./stock-market-session.ts";

test("rolling decision frames expire after the strict active-session window", () => {
  const now = new Date("2026-08-14T15:35:00.000Z");
  assert.equal(
    getDecisionFrameFreshness(
      new Date(
        now.getTime() -
          (CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS - 1) * 1_000,
      ).toISOString(),
      now,
    ).fresh,
    true,
  );
  assert.equal(
    getDecisionFrameFreshness(
      new Date(
        now.getTime() -
          (CANONICAL_DECISION_FRAME_MAX_AGE_SECONDS + 1) * 1_000,
      ).toISOString(),
      now,
    ).fresh,
    false,
  );
});

function retainedFrame() {
  return {
    sourceRun: { id: "source-run", completedAt: "2026-09-02T23:58:18.643Z" },
    opportunities: [{ ticker: "LHAI", sourceRunId: "source-run", scanSession: "after_hours",
      decisionQuoteAsOf: "2026-09-02T23:57:43Z",
      proxIntelligence: { pulse: { marketAsOf: "2026-09-02T23:58:00Z" } },
      scoreContext: { proxMarketDataAligned: true, proxMarketAdjustment: 5, proxSupportsContinuation: true,
        peakFailureConfirmed: false, proxDeepSessionRecoveryWithheld: false, proxSevereSessionPeakDamage: false },
    }],
  };
}

test("8:22 PM retained frame is valid display history, never fresh entry evidence", () => {
  const now = new Date("2026-09-03T00:22:00Z");
  const frame = retainedFrame();
  const before = JSON.stringify(frame);
  const receipt = getRetainedSessionIntegrity(frame, now);
  assert.equal(receipt.valid, true);
  assert.equal(receipt.currentSession, "closed");
  assert.equal(receipt.sourceSessionDate, "2026-09-02");
  assert.equal(receipt.oldestProviderAsOf, "2026-09-02T23:57:43.000Z");
  assert.deepEqual(getDecisionFrameMarketTimingFreshness(frame, now), { fresh: false, freshUntil: null });
  assert.equal(receipt.label, "Last session · 2026-09-02");
  assert.equal(JSON.stringify(frame), before);
});

test("retention does not excuse a missing/future/mixed-date source or foreign run", () => {
  const now = new Date("2026-09-03T00:22:00Z");
  for (const mutate of [
    (f: ReturnType<typeof retainedFrame>) => { f.sourceRun.id = ""; },
    (f: ReturnType<typeof retainedFrame>) => { f.sourceRun.completedAt = "2026-09-03T01:00:00Z"; },
    (f: ReturnType<typeof retainedFrame>) => { f.sourceRun.completedAt = "2026-09-01T23:58:00Z"; },
    (f: ReturnType<typeof retainedFrame>) => { f.opportunities = []; },
    (f: ReturnType<typeof retainedFrame>) => { f.opportunities[0].decisionQuoteAsOf = ""; },
    (f: ReturnType<typeof retainedFrame>) => { f.opportunities[0].decisionQuoteAsOf = "2026-09-01T23:58:00Z"; },
    (f: ReturnType<typeof retainedFrame>) => { f.opportunities[0].decisionQuoteAsOf = "2026-09-03T00:30:00Z"; },
    (f: ReturnType<typeof retainedFrame>) => { f.opportunities[0].sourceRunId = "another-run"; },
  ]) {
    const frame = retainedFrame(); mutate(frame);
    assert.equal(getRetainedSessionIntegrity(frame, now).valid, false);
  }
});

test("a retained ProX mismatch stays explicit and cannot carry scoring authority", () => {
  const frame = retainedFrame();
  frame.opportunities[0].proxIntelligence.pulse.marketAsOf = "2026-09-02T19:58:00Z";
  const now = new Date("2026-09-03T00:22:00Z");
  assert.equal(getRetainedSessionIntegrity(frame, now).valid, false);
  frame.opportunities[0].scoreContext.proxMarketAdjustment = 0;
  frame.opportunities[0].scoreContext.proxSupportsContinuation = false;
  const receipt = getRetainedSessionIntegrity(frame, now);
  assert.equal(receipt.valid, true);
  assert.deepEqual(receipt.unalignedProxTickers, ["LHAI"]);
  assert.equal(frame.opportunities[0].proxIntelligence.pulse.marketAsOf, "2026-09-02T19:58:00Z");
});

test("retention stops exactly when premarket opens; saved closed flags cannot bypass freshness", () => {
  const frame = retainedFrame();
  assert.equal(getRetainedSessionIntegrity(frame, new Date("2026-09-03T07:59:59Z")).valid, true);
  const open = new Date("2026-09-03T08:00:00Z");
  assert.equal(getRetainedSessionIntegrity(frame, open).valid, false);
  assert.equal(getDecisionFrameMarketTimingFreshness(frame, open).fresh, false);
  frame.opportunities[0].scanSession = "closed";
  assert.equal(getDecisionFrameMarketTimingFreshness(frame, open).fresh, false);
});

test("stock history dates handle overnight, weekends, DST and the exact close", () => {
  assert.equal(getLastCompletedStockSessionDate(new Date("2026-09-03T00:00:00Z")), "2026-09-02");
  assert.equal(getLastCompletedStockSessionDate(new Date("2026-09-05T18:00:00Z")), "2026-09-04");
  assert.equal(getLastCompletedStockSessionDate(new Date("2026-09-07T07:59:59Z")), "2026-09-04");
  assert.equal(getLastCompletedStockSessionDate(new Date("2026-11-02T08:59:59Z")), "2026-10-30");
  assert.equal(getLastCompletedStockSessionDate(new Date("2026-09-02T23:59:59Z")), null);
  assert.equal(stockHistoryLabel("2026-09-02T23:59:59Z", new Date("2026-09-03T00:00:00Z")), "Last session · 2026-09-02");
  assert.equal(stockHistoryLabel(null, new Date("2026-09-03T00:00:00Z")), "Awaiting verified data");
});

test("a pre-close cached label cannot survive the close or alter its source decision", () => {
  const record = { ...retainedFrame().opportunities[0], displayQuoteLive: true, freshnessLabel: "Live Scan",
    price: 0.73, opportunityScore: 91, rank: 1 };
  assert.equal(presentCanonicalSessionRecord(record, new Date("2026-09-02T23:59:59Z")), record);
  const displayed = presentCanonicalSessionRecord(record, new Date("2026-09-03T00:00:00Z"));
  assert.equal(displayed.freshnessLabel, "Last session · 2026-09-02");
  assert.equal(displayed.displayQuoteLive, false);
  assert.equal(record.freshnessLabel, "Live Scan");
  assert.deepEqual({ ...displayed, freshnessLabel: record.freshnessLabel, displayQuoteLive: record.displayQuoteLive }, record);
});

test("ticker detail resolves the exact contender object from the shared frame", () => {
  const contender = { ticker: "MDXH", opportunityScore: 98 };
  const frame = {
    opportunities: [{ ticker: "LFS", opportunityScore: 91 }],
    momentumContenders: [contender],
    momentumRadar: [{ ticker: "HHS", opportunityScore: 66 }],
  };
  assert.equal(findOpportunityInDecisionFrame(frame, "mdxh"), contender);
});

test("a cached frame expires when its provider-time evidence expires", () => {
  const now = new Date("2026-08-31T13:41:00.000Z");
  const base = {
    scanSession: "regular",
    decisionQuoteAsOf: "2026-08-31T13:39:00.000Z",
    proxIntelligence: {
      pulse: { marketAsOf: "2026-08-31T13:38:00.000Z" },
    },
    scoreContext: { proxMarketDataAligned: true },
  };
  const fresh = getDecisionFrameMarketTimingFreshness(
    { opportunities: [base], momentumContenders: [] },
    now,
  );
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.freshUntil, "2026-08-31T13:43:00.000Z");

  const expired = getDecisionFrameMarketTimingFreshness(
    {
      opportunities: [
        {
          ...base,
          proxIntelligence: {
            pulse: { marketAsOf: "2026-08-31T13:35:59.000Z" },
          },
        },
      ],
      momentumContenders: [],
    },
    now,
  );
  assert.equal(expired.fresh, false);
  assert.equal(expired.freshUntil, null);

  const failClosed = getDecisionFrameMarketTimingFreshness(
    {
      opportunities: [
        {
          ...base,
          proxIntelligence: null,
          scoreContext: {
            proxMarketDataAligned: false,
            proxMarketAdjustment: -8,
            proxSupportsContinuation: false,
            peakFailureConfirmed: false,
            proxDeepSessionRecoveryWithheld: false,
            proxSevereSessionPeakDamage: false,
          },
        },
      ],
      momentumContenders: [],
    },
    now,
  );
  assert.equal(failClosed.fresh, true);
  assert.equal(failClosed.freshUntil, "2026-08-31T13:44:00.000Z");
});
