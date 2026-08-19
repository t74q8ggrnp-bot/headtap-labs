import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source
// extension while the production bundler resolves the same module extensionless.
import { isSupportedType } from "../security-type-policy.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source
// extension while the production bundler resolves the same module extensionless.
import { routeProxSecurityType, selectProxRoutedResearchCandidates } from "./security-routing.ts";

test("routes common shares and ADR common shares to the opportunity lane", () => {
  for (const securityType of ["CS", "ADRC"]) {
    const route = routeProxSecurityType(securityType);
    assert.equal(route.instrumentLane, "opportunity_equity");
    assert.equal(route.opportunityEligible, true);
    assert.equal(route.metadataState, "verified");
  }
});

test("routes every approved context, linked, and excluded type without scoring it as equity", () => {
  for (const securityType of ["ETF", "ETN", "ETV", "FUND", "INDEX"]) {
    assert.equal(routeProxSecurityType(securityType).instrumentLane, "market_context");
    assert.equal(routeProxSecurityType(securityType).opportunityEligible, false);
  }
  for (const securityType of ["WARRANT", "RIGHT", "UNIT", "ADRW", "ADRR"]) {
    assert.equal(
      routeProxSecurityType(securityType).instrumentLane,
      "linked_instrument_context",
    );
    assert.equal(routeProxSecurityType(securityType).opportunityEligible, false);
  }
  for (const securityType of ["PFD", "ADRP", "BOND", "SP", "BASKET", "OTHER"]) {
    assert.equal(routeProxSecurityType(securityType).instrumentLane, "excluded_asset");
    assert.equal(routeProxSecurityType(securityType).opportunityEligible, false);
  }
  assert.equal(
    routeProxSecurityType("NEW_PROVIDER_CODE").instrumentLane,
    "pending_verification",
  );
  assert.equal(
    routeProxSecurityType(null).instrumentLane,
    "pending_verification",
  );
  assert.equal(
    routeProxSecurityType("GDR").instrumentLane,
    "pending_verification",
  );
});

test("reserves auxiliary research lanes without allowing them to crowd out equities", () => {
  const equities = Array.from({ length: 300 }, (_, index) => ({
    ticker: `E${String(index).padStart(3, "0")}`,
    researchPriority: 50,
    dollarVolume: 1_000_000 - index,
    instrumentLane: "opportunity_equity" as const,
  }));
  const context = Array.from({ length: 50 }, (_, index) => ({
    ticker: `C${String(index).padStart(3, "0")}`,
    researchPriority: 100,
    dollarVolume: 2_000_000,
    instrumentLane: "market_context" as const,
  }));
  const selected = selectProxRoutedResearchCandidates([...equities, ...context]);

  assert.equal(selected.length, 300);
  assert.equal(
    selected.filter((candidate) => candidate.instrumentLane === "market_context").length,
    25,
  );
  assert.equal(
    selected.filter((candidate) => candidate.instrumentLane === "opportunity_equity").length,
    275,
  );
});

test("does not change the canonical CS and ADRC-only support policy", () => {
  assert.equal(isSupportedType("CS"), true);
  assert.equal(isSupportedType("ADRC"), true);
  assert.equal(isSupportedType("ETF"), false);
  assert.equal(isSupportedType("WARRANT"), false);
  assert.equal(isSupportedType("GDR"), false);
});
