import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { classifyHtAgentTargetResearchFailure, sanitizeHtAgentTargetResearchFailureMessage, summarizeHtAgentTargetResearchSeedFailures } from "./target-research-observability.ts";

test("target research receipts explain evidence, deduplication, persistence, and scheduling failures", () => {
  assert.equal(classifyHtAgentTargetResearchFailure({ error_code: "22P02" }), "eligibility_or_evidence");
  assert.equal(classifyHtAgentTargetResearchFailure({ error_code: "23505" }), "deduplication");
  assert.equal(classifyHtAgentTargetResearchFailure({ error_code: "42P01" }), "persistence_or_schema");
  assert.equal(classifyHtAgentTargetResearchFailure({ error_code: "23503" }), "scheduling_or_reference");
  assert.equal(
    sanitizeHtAgentTargetResearchFailureMessage("  invalid   value  "),
    "invalid value",
  );
});

test("target research receipt summaries are sanitized, bounded, and explicitly non-authoritative", () => {
  const id = "db9a2aa3-7e2b-49d1-a334-308ff6749cc8";
  const summary = summarizeHtAgentTargetResearchSeedFailures([
    { error_code: "22P02", error_message: `invalid numeric value for ${id}`, horizon: "15m", failed_at: "2026-09-22T12:00:00.000Z" },
    { error_code: "22P02", error_message: `invalid numeric value for ${id}`, horizon: "60m", failed_at: "2026-09-22T12:01:00.000Z" },
  ], 2);

  assert.equal(summary.authority, "research_only");
  assert.equal(summary.primaryProductImpact, false);
  assert.equal(summary.providerRequestsAdded, 0);
  assert.equal(summary.receiptCoverageComplete, true);
  assert.deepEqual(summary.byCategory, { eligibility_or_evidence: 2 });
  assert.equal(summary.latestFailureAt, "2026-09-22T12:01:00.000Z");
  assert.equal(summary.representativeMessages[0]?.count, 2);
  assert.match(summary.representativeMessages[0]?.message ?? "", /\[id\]/);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(id));
});

test("target research summaries disclose when the receipt sample is incomplete", () => {
  const summary = summarizeHtAgentTargetResearchSeedFailures([], 579);
  assert.equal(summary.reportedTotal, 579);
  assert.equal(summary.receiptsInspected, 0);
  assert.equal(summary.receiptCoverageComplete, false);
});
