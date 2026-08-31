import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { auditTopMoverDispositions, describeTopMoverDisposition, findTopMoverDisposition } from "./top-mover-disposition.ts";

test("requires an explicit outcome for every sampled Polygon mover", () => {
  const audit = auditTopMoverDispositions([
    {
      ticker: "MDXH",
      changePercent: 86,
      status: "canonical_candidate",
      reason: "spot_momentum_retrieval",
    },
    {
      ticker: "ONFOW",
      changePercent: 314,
      status: "excluded",
      reason: "unsupported_security_type:WARRANT",
    },
  ]);
  assert.equal(audit.complete, true);
  assert.equal(audit.canonicalCount, 1);
  assert.equal(audit.excludedCount, 1);
});

test("fails when a top mover silently remains pending", () => {
  const audit = auditTopMoverDispositions([
    {
      ticker: "UMAL",
      changePercent: 53,
      status: "pending",
      reason: "",
    },
  ]);
  assert.equal(audit.complete, false);
  assert.deepEqual(audit.unresolved, ["UMAL"]);
});

test("finds and explains a ticker excluded before canonical evaluation", () => {
  const disposition = findTopMoverDisposition(
    [
      {
        ticker: "IREZ",
        changePercent: 26.2,
        status: "excluded",
        reason: "prior_day_liquidity_below_floor",
      },
    ],
    "irez",
  );
  assert.ok(disposition);
  assert.match(describeTopMoverDisposition(disposition), /liquidity gate/i);
});
