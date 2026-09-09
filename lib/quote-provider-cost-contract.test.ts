import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handler = readFileSync(
  new URL("../app/api/quote/route.ts", import.meta.url),
  "utf8",
);

test("recurring quote path preflights coordination before exactly three provider calls", () => {
  const preflight = handler.indexOf("await preflightStockDisplayFrameCoordination()");
  const providerBatch = handler.indexOf("await Promise.all([");

  assert.ok(preflight >= 0);
  assert.ok(providerBatch > preflight);
  assert.equal(handler.match(/callProvider\(\(\) => fetchMassive/g)?.length, 3);
  assert.doesNotMatch(handler, /fetchHydratedSessionSnapshot/);
  assert.doesNotMatch(handler, /probeMassiveRealtimeEntitlement/);
  assert.match(handler, /sessionOhlcvHydrated: false/);
  assert.match(handler, /X-HT-Provider-Requests-Attempted/);
});
