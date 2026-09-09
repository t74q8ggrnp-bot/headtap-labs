import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { canonicalLaneLabel, describeCanonicalDecisionFrameFreshness, describeCanonicalOpportunityFreshness, describeWorkspaceReadFreshness, normalizeWorkspaceCanonicalDecisionFrame } from "./workspace-intelligence-display.ts";

const nowMs = Date.parse("2026-09-08T14:00:00.000Z");

test("workspace labels the two Canonical authorities explicitly", () => {
  assert.equal(canonicalLaneLabel("spot_momentum"), "Spot Momentum Canonical");
  assert.equal(canonicalLaneLabel("before_the_crowd"), "Before the Crowd Canonical");
  assert.equal(canonicalLaneLabel(undefined), "Canonical lane unavailable");
});

test("active-session Canonical intelligence uses the strict 90-second freshness contract", () => {
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-08T13:58:30.000Z", nowMs, marketActive: true }).state, "fresh");
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-08T13:56:30.000Z", nowMs, marketActive: true }).state, "stale");
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-08T13:50:00.000Z", nowMs, marketActive: true }).state, "stale");
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-08T13:59:30.000Z", nowMs, marketActive: true, providerFresh: false }).state, "stale");
});

test("ProX can use its bounded pulse freshness windows without borrowing Canonical thresholds", () => {
  assert.equal(describeWorkspaceReadFreshness({
    timestamp: "2026-09-08T13:55:00.000Z",
    nowMs,
    marketActive: true,
    providerFresh: true,
    freshMaxAgeSeconds: 360,
    staleAfterSeconds: 900,
  }).state, "fresh");
  assert.equal(describeWorkspaceReadFreshness({
    timestamp: "2026-09-08T13:52:00.000Z",
    nowMs,
    marketActive: true,
    providerFresh: true,
    freshMaxAgeSeconds: 360,
    staleAfterSeconds: 900,
  }).state, "aging");
});

test("closed-session and invalid timestamps remain honest", () => {
  const retained = describeWorkspaceReadFreshness({ timestamp: "2026-09-05T20:00:00.000Z", nowMs, marketActive: false });
  assert.equal(retained.state, "last_session");
  assert.match(retained.label, /^Last verified/);
  assert.equal(describeWorkspaceReadFreshness({ timestamp: null, nowMs, marketActive: true }).state, "unavailable");
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-08T14:03:00.000Z", nowMs, marketActive: true }).state, "misaligned");
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-05T20:00:00.000Z", nowMs, marketActive: false, providerFresh: false }).state, "stale");
  assert.equal(describeWorkspaceReadFreshness({ timestamp: "2026-09-08T13:59:30.000Z", nowMs, marketActive: true, providerAligned: false }).state, "misaligned");
});

test("Canonical freshness requires the server decision frame and never borrows scannedAt", () => {
  assert.deepEqual(
    describeCanonicalDecisionFrameFreshness({
      frame: null,
      nowMs,
      marketActive: true,
    }),
    {
      state: "unavailable",
      ageSeconds: null,
      label: "Decision frame unavailable",
    },
  );
});

test("Canonical decision-frame status and expiry remain authoritative", () => {
  const live = normalizeWorkspaceCanonicalDecisionFrame({
    version: "rolling-canonical-decision-frame-v6-scenario-integrity",
    decisionAsOf: "2026-09-08T13:59:30.000Z",
    presentedAt: "2026-09-08T13:59:31.000Z",
    freshUntil: "2026-09-08T14:01:00.000Z",
    ageSeconds: 30,
    maxAgeSeconds: 90,
    fresh: true,
    status: "live",
    currentSession: "regular",
  });
  assert.equal(describeCanonicalDecisionFrameFreshness({ frame: live, nowMs, marketActive: true }).state, "fresh");
  assert.equal(describeCanonicalDecisionFrameFreshness({ frame: live, nowMs: Date.parse("2026-09-08T14:02:00.000Z"), marketActive: true }).state, "stale");

  const stale = normalizeWorkspaceCanonicalDecisionFrame({
    decisionAsOf: "2026-09-08T13:59:30.000Z",
    freshUntil: "2026-09-08T14:01:00.000Z",
    fresh: false,
    status: "stale",
  });
  assert.equal(describeCanonicalDecisionFrameFreshness({ frame: stale, nowMs, marketActive: true }).state, "stale");

  const retained = normalizeWorkspaceCanonicalDecisionFrame({
    decisionAsOf: "2026-09-05T20:00:00.000Z",
    fresh: false,
    status: "last_session",
    currentSession: "closed",
  });
  assert.equal(describeCanonicalDecisionFrameFreshness({ frame: retained, nowMs, marketActive: false }).state, "last_session");

  const explicitlyStaleAfterClose = normalizeWorkspaceCanonicalDecisionFrame({
    decisionAsOf: "2026-09-05T20:00:00.000Z",
    fresh: false,
    status: "stale",
    currentSession: "closed",
  });
  assert.equal(describeCanonicalDecisionFrameFreshness({ frame: explicitlyStaleAfterClose, nowMs, marketActive: false }).state, "stale");
});

test("Canonical badge also validates the selected ticker's provider evidence", () => {
  const frame = normalizeWorkspaceCanonicalDecisionFrame({
    decisionAsOf: "2026-09-08T13:59:30.000Z",
    presentedAt: "2026-09-08T13:59:31.000Z",
    freshUntil: "2026-09-08T14:01:00.000Z",
    fresh: true,
    status: "live",
  });
  assert.equal(describeCanonicalOpportunityFreshness({
    frame,
    decisionQuoteAsOf: "2026-09-08T13:50:00.000Z",
    nowMs,
    marketActive: true,
  }).state, "stale");
  assert.equal(describeCanonicalOpportunityFreshness({
    frame,
    decisionQuoteAsOf: null,
    nowMs,
    marketActive: true,
  }).state, "unavailable");
});

test("malformed decision frames fail closed", () => {
  assert.equal(normalizeWorkspaceCanonicalDecisionFrame({ status: "fresh" }), null);
  const missingTime = normalizeWorkspaceCanonicalDecisionFrame({
    status: "live",
    fresh: true,
  });
  assert.equal(describeCanonicalDecisionFrameFreshness({ frame: missingTime, nowMs, marketActive: true }).state, "unavailable");
});
