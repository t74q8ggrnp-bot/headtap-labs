import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension while the production bundler resolves the same module extensionless.
import { compactHomeInitialOpportunityPayload } from "./home-initial-payload.ts";

test("caps first-paint opportunity arrays without changing their records", () => {
  const opportunities = Array.from({ length: 100 }, (_, index) => ({
    ticker: `T${index}`,
    score: 100 - index,
  }));
  const contenders = Array.from({ length: 8 }, (_, index) => ({
    ticker: `C${index}`,
  }));
  const radar = Array.from({ length: 15 }, (_, index) => ({
    ticker: `R${index}`,
  }));

  const result = compactHomeInitialOpportunityPayload(
    { opportunities, momentumContenders: contenders, momentumRadar: radar },
    15,
  );

  assert.equal(result?.opportunities?.length, 15);
  assert.equal(result?.momentumContenders?.length, 5);
  assert.equal(result?.momentumRadar?.length, 10);
  assert.equal(result?.opportunities?.[0], opportunities[0]);
});

test("does not serialize internal decision-frame metadata", () => {
  const result = compactHomeInitialOpportunityPayload(
    {
      opportunities: [{ ticker: "HT" }],
      momentumContenders: [],
      momentumRadar: [],
      sourceRun: { id: "internal" },
      decisionFrame: { version: "internal" },
    } as never,
    15,
  );

  assert.deepEqual(Object.keys(result ?? {}).sort(), [
    "momentumContenders",
    "momentumRadar",
    "opportunities",
  ]);
});

test("returns null when the server frame is unavailable", () => {
  assert.equal(compactHomeInitialOpportunityPayload(null, 15), null);
});
