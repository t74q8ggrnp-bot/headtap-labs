// Health-policy regression tests. No credentials, database, provider, or production access.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CRYPTO_PRODUCT_CAPABILITIES,
  buildShelvedCryptoHealthCheck,
  cryptoProviderCallsAreProhibited,
  isCryptoProductIntentionallyShelved,
} from "../lib/crypto/product-capabilities.ts";

const source = await readFile(
  new URL("../app/api/system-health/route.ts", import.meta.url),
  "utf8",
);
const evidenceHealthSource = await readFile(
  new URL("../lib/crypto/evidence-health.ts", import.meta.url),
  "utf8",
);
const paperHealthSource = await readFile(
  new URL("../lib/crypto/paper-health.ts", import.meta.url),
  "utf8",
);

test("the code-owned shelved state is one explicit green health check", () => {
  assert.equal(isCryptoProductIntentionallyShelved(), true);
  assert.equal(cryptoProviderCallsAreProhibited(), true);
  assert.ok(Object.values(CRYPTO_PRODUCT_CAPABILITIES).every((enabled) => enabled === false));

  const check = buildShelvedCryptoHealthCheck(undefined, {
    configuredCryptoSchedules: [],
    activityReadStatus: "verified",
    latestPublicCollectionAt: null,
    latestCoinApiRequestAt: null,
    latestRecordedProviderActivityAt: null,
    coinApiDatabaseCollectionEnabled: true,
    checkedAt: new Date().toISOString(),
  });
  assert.equal(check.name, "crypto_product_status");
  assert.equal(check.ok, true);
  assert.equal(check.detail.state, "intentionally_disabled");
  assert.equal(check.detail.providerCallsProhibited, true);
  assert.equal(check.detail.scheduledCollectionExpected, false);
  assert.equal(check.detail.runtimeCollectionEntryPointsFailClosed, true);
  assert.equal(check.detail.historicalCodeAndDataPolicy, "preserved_read_only");
  assert.equal(check.detail.operationalEvidence.activityReadStatus, "verified");
  assert.equal(check.detail.scheduledCollectionConfig.absent, true);
  assert.equal(check.detail.databaseToggleCanReactivateCrypto, false);
  assert.equal(buildShelvedCryptoHealthCheck().ok, false);
});

test("health emits shelving before database setup and excludes crypto from outage uncertainty", () => {
  const shelvingState = source.indexOf(
    "const cryptoIntentionallyShelved = isCryptoProductIntentionallyShelved();",
  );
  const shelvingCheck = source.indexOf(
    "checks.push(buildShelvedCryptoHealthCheck(",
  );
  const databaseSetup = source.indexOf("const supabase = getSupabase();");
  assert.ok(shelvingState >= 0);
  assert.ok(shelvingState < shelvingCheck && shelvingCheck < databaseSetup);
  assert.match(
    source,
    /unverified:\s*\["canonical",\s*"prox",\s*"paper_trading",\s*"ht_agent",\s*"massive_entitlement"\]/,
  );
  assert.match(source, /readShelvedCryptoOperationalEvidence/);
  assert.match(source, /ht_crypto_prox_collection_runs/);
  assert.match(source, /ht_coinapi_pilot_requests/);
  assert.match(source, /ht_coinapi_pilot_control/);
  assert.match(source, /CONFIGURED_CRYPTO_SCHEDULES/);
});

test("every historical crypto database check remains behind the reactivation branch", () => {
  const guard = source.indexOf("if (!cryptoIntentionallyShelved) {");
  const legacyStart = source.indexOf("const cryptoConfiguration =", guard);
  const nextSubsystem = source.indexOf(
    "// HT Agent is an isolated paper-only consumer.",
    legacyStart,
  );
  assert.ok(guard >= 0 && guard < legacyStart && legacyStart < nextSubsystem);

  const guardedLegacyCode = source.slice(guard, nextSubsystem);
  for (const databaseBoundary of [
    "ht_crypto_evidence_health_snapshot",
    "ht_crypto_paper_health",
    "ht_crypto_prox_collection_runs",
    "ht_crypto_discovery_runs",
  ]) {
    assert.match(guardedLegacyCode, new RegExp(databaseBoundary));
  }
  assert.match(guardedLegacyCode, /cryptoWarnings = cryptoEvidence\.warnings/);
});

test("reactivation retains the prior hard checks instead of weakening them", () => {
  const guard = source.indexOf("if (!cryptoIntentionallyShelved) {");
  const nextSubsystem = source.indexOf(
    "// HT Agent is an isolated paper-only consumer.",
    guard,
  );
  const guardedLegacyCode = source.slice(guard, nextSubsystem);
  for (const name of [
    "crypto_legacy_evidence_audit",
    "crypto_coinapi_collection",
    "crypto_coinapi_outcomes",
  ]) {
    assert.match(evidenceHealthSource, new RegExp(name));
  }
  assert.match(paperHealthSource, /crypto_manual_paper_ledger/);
  assert.match(guardedLegacyCode, /checks\.push\(\.\.\.cryptoEvidence\.checks\)/);
  assert.match(guardedLegacyCode, /assessCryptoPaperHealth/);
  for (const name of [
    "crypto_prox_observation_pipeline",
    "crypto_atomic_decision_frame",
    "crypto_multivenue_shadow_discovery",
  ]) assert.match(guardedLegacyCode, new RegExp(name));
  assert.match(source, /const hardFailures = checks\.filter\(\(check\) => !check\.ok\)/);
});

test("crypto warnings stay empty while shelved and all crypto schedules are absent", async () => {
  const warningsDeclaration = source.indexOf("let cryptoWarnings:");
  const guardedAssignment = source.indexOf("cryptoWarnings = cryptoEvidence.warnings;");
  const guard = source.indexOf("if (!cryptoIntentionallyShelved) {", warningsDeclaration);
  assert.ok(warningsDeclaration >= 0 && guard > warningsDeclaration && guardedAssignment > guard);
  assert.match(source, /warnings:\s*\[\s*\.\.\.cryptoWarnings/);

  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    config.crons.filter((cron) => cron.path.startsWith("/api/crypto/")),
    [],
  );
});
