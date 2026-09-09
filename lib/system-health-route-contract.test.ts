import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/api/system-health/route.ts", import.meta.url),
  "utf8",
);
const handler = source.slice(source.indexOf("export async function GET"));

test("deep health is rate-limited before database or provider work", () => {
  assert.match(handler, /checkApiRateLimit\(request/);
  assert.ok(
    handler.indexOf("if (!rateLimit.allowed)") <
      handler.indexOf("const supabase = getSupabase()"),
  );
  assert.doesNotMatch(source, /probeMassiveRealtimeEntitlement/);
});

test("database liveness precedes Phase 1 catalog and coordination probes", () => {
  const databaseProbe = handler.indexOf("await probeDatabaseHealth");
  const displayPreflight = handler.indexOf(
    "await preflightStockDisplayFrameCoordination",
  );
  const catalogProbe = handler.indexOf(
    '"ht_phase1_workspace_infrastructure_health"',
  );
  assert.ok(databaseProbe >= 0);
  assert.ok(displayPreflight > databaseProbe);
  assert.ok(catalogProbe > databaseProbe);
});

test("health uses the shared holiday-aware presentation session authority", () => {
  assert.match(
    handler,
    /const pollingSession = marketChartPollingState\(new Date\(\), "extended"\)/,
  );
  assert.match(
    handler,
    /pollingSession\.reason === "market_holiday"/,
  );
});

test("Massive entitlement is proven from persisted provider receipts at zero probe cost", () => {
  assert.match(handler, /persistedMassiveRealtimeEvidence/);
  assert.match(handler, /providerRequestsUsedByProbe:\s*0/);
  assert.match(handler, /verificationSource:\s*"prox_realtime_microstructure_run"/);
});
