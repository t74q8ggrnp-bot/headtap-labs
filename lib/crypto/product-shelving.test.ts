import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node strip-types requires source extensions.
import { CRYPTO_PRODUCT_CAPABILITIES, buildShelvedCryptoHealthCheck, createCryptoProductCapabilities, cryptoProviderCallsAreProhibited, isCryptoProductIntentionallyShelved, withCryptoCapabilities } from "./product-capabilities.ts";
// @ts-expect-error Node strip-types requires source extensions.
import { createCoinApiClient } from "./coinapi-client.ts";

const rootFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the code-owned crypto product contract defaults every capability off", () => {
  assert.equal(Object.isFrozen(CRYPTO_PRODUCT_CAPABILITIES), true);
  assert.deepEqual(CRYPTO_PRODUCT_CAPABILITIES, {
    publicUiEnabled: false,
    publicApiEnabled: false,
    providerCollectionEnabled: false,
    paperOrderEntryEnabled: false,
    paperMatchingEnabled: false,
    coinApiResearchCollectionEnabled: false,
    coinApiEvidenceMaintenanceEnabled: false,
  });
  assert.equal(isCryptoProductIntentionallyShelved(), true);
  assert.equal(cryptoProviderCallsAreProhibited(), true);
});

test("disabled routes return one sanitized response without invoking their handler", async () => {
  let calls = 0;
  const guarded = withCryptoCapabilities("publicApiEnabled", async () => {
    calls++;
    return Response.json({ secret: "must-not-run" });
  });
  const response = await guarded();
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "CRYPTO_PRODUCT_UNAVAILABLE",
    error: "Crypto is currently unavailable.",
  });
});

test("a controlled injected capability reaches the preserved code path", async () => {
  const capabilities = createCryptoProductCapabilities({ publicApiEnabled: true });
  let calls = 0;
  const guarded = withCryptoCapabilities("publicApiEnabled", async (value: string) => {
    calls++;
    return Response.json({ value });
  }, capabilities);
  const response = await guarded("preserved");
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { value: "preserved" });
});

test("CoinAPI transport is blocked before cache, reservations, or network by default", async () => {
  let networkCalls = 0;
  const client = createCoinApiClient({
    apiKey: "test-placeholder",
    fetcher: async () => {
      networkCalls++;
      return Response.json({});
    },
  });
  await assert.rejects(
    client.get("/v1/quotes/COINBASE_SPOT_BTC_USD/current"),
    /currently unavailable/i,
  );
  assert.equal(networkCalls, 0);
  assert.equal(client.usage().requests, 0);
});

test("all crypto HTTP boundaries use the centralized fail-closed contract", () => {
  const matrix: Array<[string, string]> = [
    ["app/api/crypto/opportunities/route.ts", "publicApiEnabled"],
    ["app/api/crypto/discovery/route.ts", "publicApiEnabled"],
    ["app/api/crypto/quotes/route.ts", "providerCollectionEnabled"],
    ["app/api/crypto/prox-sensor/route.ts", "providerCollectionEnabled"],
    ["app/api/crypto/coinapi-collector/route.ts", "coinApiResearchCollectionEnabled"],
    ["app/api/crypto/coinapi-research/route.ts", "publicApiEnabled"],
    ["app/api/crypto/coinapi-evaluation/route.ts", "publicApiEnabled"],
    ["app/api/crypto/evidence-maintenance/route.ts", "coinApiEvidenceMaintenanceEnabled"],
    ["app/api/crypto/paper/route.ts", "paperOrderEntryEnabled"],
    ["app/api/crypto-freshness-diagnostics/route.ts", "providerCollectionEnabled"],
    ["app/api/crypto-outcome-diagnostics/route.ts", "publicApiEnabled"],
  ];
  for (const [path, capability] of matrix) {
    const source = rootFile(path);
    assert.match(source, /withCryptoCapabilities/);
    assert.equal(source.includes(capability), true, `${path} is missing ${capability}`);
  }
});

test("direct pages fail before rendering and public product surfaces contain no crypto entry", () => {
  const proxy = rootFile("proxy.ts");
  assert.match(proxy, /publicUiEnabled/);
  assert.match(proxy, /status:\s*404/);
  assert.match(proxy, /"\/crypto\/:path\*"/);
  assert.match(proxy, /"\/paper\/crypto\/:path\*"/);

  for (const path of [
    "app/page.tsx",
    "app/HomeClient.tsx",
    "app/components/mobile/MobileExperience.tsx",
    "app/components/MobileAppNavigation.tsx",
    "app/components/paper/PaperTradingDashboard.tsx",
    "app/components/agent/HtAgentDashboard.tsx",
  ]) {
    const source = rootFile(path);
    assert.doesNotMatch(source, /href=["']\/crypto/);
    assert.doesNotMatch(source, /CryptoMomentumPreview/);
    assert.doesNotMatch(source, /useCryptoOpportunityFeed/);
  }

  const mobileCapabilities = rootFile("app/api/mobile-capabilities/route.ts");
  assert.match(
    mobileCapabilities,
    /status:\s*cryptoShelved\s*\?\s*"shelved"\s*:\s*"active_or_partial"/,
  );
  assert.match(mobileCapabilities, /endpointLinks:\s*\{\}/);
  assert.match(
    mobileCapabilities,
    /providerCallsAllowed:\s*cryptoProviderCallsAllowed/,
  );
  assert.match(
    rootFile("docs/IOS_SYNC_CONTRACT.md"),
    /require every published\s+crypto capability to be `false`/,
  );
});

test("market-chart rejects crypto before the provider branch and preserves stock", () => {
  const source = rootFile("app/api/market-chart/route.ts");
  const guard = source.indexOf('asset === "crypto"');
  const provider = source.indexOf("await fetchMassiveCryptoChart");
  assert.ok(guard >= 0 && provider > guard);
  assert.match(source, /if \(asset === "stock"\)/);
  assert.match(source, /providerReceipt\("minute_history"/);
});

test("provider adapters assert the collection capability before network access", () => {
  for (const path of [
    "lib/massive-crypto.ts",
    "lib/crypto-display-fallback.ts",
    "lib/crypto/coinbase-public.ts",
    "lib/crypto/multi-venue-discovery.ts",
  ]) {
    const source = rootFile(path);
    const guard = source.indexOf('assertCryptoCapabilitiesEnabled("providerCollectionEnabled")');
    const network = source.indexOf("await fetch(");
    assert.ok(guard >= 0 && network > guard, `${path} does not guard its first provider call`);
  }
});

test("paper entry and matching fail closed before database work", () => {
  const source = rootFile("lib/crypto/paper-server.ts");
  for (const name of [
    "openCryptoPaper",
    "previewCryptoPaper",
    "previewCryptoPaperBudget",
    "submitCryptoPaper",
    "cancelCryptoPaper",
  ]) {
    const body = source.slice(source.indexOf(`function ${name}`));
    assert.ok(body.indexOf("requireCryptoPaperEntry();") < body.indexOf("rpc<"));
  }
  const matcher = source.slice(source.indexOf("function matchCryptoPaperOrders"));
  assert.ok(matcher.indexOf('paperMatchingEnabled') < matcher.indexOf("coinApiPilotService()"));
  assert.match(matcher, /status:\s*"shelved"/);
  assert.match(matcher, /processed:\s*0/);
  assert.match(matcher, /fills:\s*0/);
});

test("shelved crypto contributes one green bounded health state and no old warnings", () => {
  const check = buildShelvedCryptoHealthCheck(undefined, {
    configuredCryptoSchedules: [],
    activityReadStatus: "verified",
    latestPublicCollectionAt: null,
    latestCoinApiRequestAt: null,
    latestRecordedProviderActivityAt: null,
    coinApiDatabaseCollectionEnabled: true,
    checkedAt: new Date().toISOString(),
  });
  assert.equal(check.ok, true);
  assert.equal(check.detail.state, "intentionally_disabled");
  assert.equal(check.detail.providerCallsProhibited, true);
  assert.equal(check.detail.scheduledCollectionExpected, false);
  assert.equal(check.detail.scheduledCollectionConfig.absent, true);
  assert.equal(check.detail.databaseToggleCanReactivateCrypto, false);
  assert.equal(buildShelvedCryptoHealthCheck().ok, false);

  const health = rootFile("app/api/system-health/route.ts");
  assert.ok(
    health.indexOf("checks.push(buildShelvedCryptoHealthCheck(") <
      health.indexOf("const supabase = getSupabase()"),
  );
  assert.ok(
    health.indexOf("isCryptoProductIntentionallyShelved()") <
      health.indexOf("const cryptoConfiguration"),
  );
  assert.match(health, /checks\.push\(buildShelvedCryptoHealthCheck\(/);
  assert.match(health, /\.\.\.cryptoWarnings/);
});

test("no crypto cron remains while stock, ProX, and Agent schedules stay active", () => {
  const config = JSON.parse(rootFile("vercel.json")) as {
    crons: Array<{ path: string }>;
  };
  assert.deepEqual(config.crons.filter((job) => job.path.startsWith("/api/crypto/")), []);
  for (const required of [
    "/api/paper-trading/match",
    "/api/prox-market-sensor",
    "/api/ht-agent/cycle",
    "/api/ht-agent/outcomes",
  ]) {
    assert.equal(config.crons.some((job) => job.path === required), true);
  }
});
