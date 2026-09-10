import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0052_agent_x_visual_paper_plans.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../supabase/migrations/0053_agent_x_visual_plan_verification.sql", import.meta.url),
  "utf8",
);
const release = readFileSync(
  new URL("../../supabase/migrations/0054_agent_x_visual_plan_release_contract.sql", import.meta.url),
  "utf8",
);
const internalVisible = readFileSync(
  new URL("../../supabase/migrations/0055_agent_x_visual_plan_internal_visible.sql", import.meta.url),
  "utf8",
);

test("Phase 2 starts off and cannot authorize live execution", () => {
  assert.match(migration, /visual_plan_mode text not null default 'off'/);
  assert.match(migration, /visual_plan_lifecycle_enabled boolean not null default false/);
  assert.match(migration, /visual_plan_paper_handoff_enabled boolean not null default false/);
  assert.match(migration, /p_definition->>'executionAuthority' is distinct from 'none'/);
  assert.doesNotMatch(migration, /robinhood|live[_ ]broker|alpaca[_ ]live/i);
});

test("plan versions, evidence, events, and worker receipts are immutable", () => {
  for (const trigger of [
    "ht_agent_visual_plan_versions_immutable",
    "ht_agent_visual_plan_events_immutable",
    "ht_agent_visual_plan_evidence_immutable",
    "ht_agent_visual_plan_worker_runs_immutable",
  ]) assert.match(migration, new RegExp(trigger));
  assert.match(migration, /visual_plan_state_version_conflict/);
  assert.match(migration, /visual_plan_non_monotonic_transition/);
  assert.match(migration, /for update/);
});

test("the approved provider-minute expiry and ambiguity contracts are database enforced", () => {
  assert.match(migration, /agent-x-visual-plan-expiry-v1-15-provider-minutes/);
  assert.match(migration, /visual_plan_expiration_contract_mismatch/);
  assert.match(migration, /v_expires_at>v_valid_from\+interval '15 minutes'/);
  assert.match(migration, /needs_review_ambiguous/);
  assert.match(migration, /candle_closed_at-candle_opened_at=interval '1 minute'/);
  assert.match(migration, /provider_timestamp=candle_closed_at/);
  assert.match(migration, /paper_orders_visual_plan_active_unique/);
  assert.match(migration, /paper_orders_strategy_source_check/);
  assert.match(migration, /'ht_agent'/);
});

test("verification checks rollout, immutable boundaries, access, and idempotency", () => {
  assert.match(verifier, /immutabilityReady/);
  assert.match(verifier, /accessBoundaryReady/);
  assert.match(verifier, /duplicateIdempotencyKeys/);
  assert.match(verifier, /orphanStates/);
  assert.match(verifier, /paperHandoffSchemaReady/);
  assert.match(verifier, /rollout/);
});

test("forward-only release contract stores separate deterministic target R/R and cancellation policy", () => {
  assert.match(release, /agent-x-visual-paper-plan-v2/);
  assert.match(release, /agent-x-risk-reward-v1-least-favorable-entry/);
  assert.match(release, /target_one_risk_reward/);
  assert.match(release, /target_two_risk_reward/);
  assert.match(release, /round\(\(v_target_one-greatest\(v_entry_high,v_trigger\)\)\/\(greatest\(v_entry_high,v_trigger\)-v_stop\),6\)/);
  assert.match(release, /agent-x-cancellation-v1-provider-minute/);
  assert.match(release, /intraminute_order_unprovable/);
});

test("0054 enables only shadow and 0055 promotes only after a fail-closed verifier", () => {
  assert.match(release, /visual_plan_mode='shadow'/);
  assert.match(release, /visual_plan_lifecycle_enabled=true/);
  assert.match(release, /visual_plan_paper_handoff_enabled=false/);
  assert.match(release, /ht_agent_phase2_visual_plan_release_health/);
  assert.match(release, /phase2_shadow_verification_not_ready/);
  assert.match(internalVisible, /ht_agent_promote_visual_plan_internal_visible/);
  assert.doesNotMatch(internalVisible, /visual_plan_paper_handoff_enabled=true/);
});

test("closed-market lifecycle telemetry cannot claim evidence or provider requests", () => {
  assert.match(release, /ht_agent_visual_plan_worker_runs_closed_request_check/);
  assert.match(release, /closed_market_skipped/);
  assert.match(release, /provider_request_count=0/);
  assert.match(release, /closedMarketLifecycleRequests/);
});
