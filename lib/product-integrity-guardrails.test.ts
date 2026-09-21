import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("global public endpoint throttling is service-only and atomic", () => {
  const migration = source("supabase/migrations/0060_product_integrity_guardrails.sql");
  assert.match(migration, /ht_consume_public_api_rate_limit/);
  assert.match(migration, /on conflict \(bucket_key\) do update set/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/);
  assert.match(migration, /scoringAuthorityChanged', false/);
  assert.match(migration, /executionAuthorityChanged', false/);
});

test("security headers and deployment provenance are explicit release gates", () => {
  const config = source("next.config.ts");
  const health = source("app/api/system-health/route.ts");
  for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
    assert.match(config, new RegExp(header));
  }
  assert.match(config, /poweredByHeader: false/);
  assert.match(health, /releaseIntegrity/);
  assert.match(health, /releaseReady: releaseProvenance\.ok && schemaVerified/);
  assert.match(health, /const schemaVerified = productIntegrityGuardrailsVerified/);
  assert.doesNotMatch(health, /schemaVerified = researchObservabilityVerified/);
});

test("Bull Bear failures are unavailable and never fabricate directional cases", () => {
  const route = source("app/api/bull-bear/route.ts");
  assert.match(route, /status: "unavailable"/);
  assert.match(route, /No analysis was fabricated/);
  assert.match(route, /unstable_cache/);
  assert.match(route, /response_format: \{ type: "json_object" \}/);
  assert.doesNotMatch(route, /Momentum building with above-average volume/);
  assert.doesNotMatch(route, /use general market knowledge about this ticker/);
});

test("QA never infers authentication success from an exception", () => {
  const qa = source("app/qa/page.tsx");
  assert.match(qa, /status: "unavailable"/);
  assert.match(qa, /No pass was inferred/);
  assert.doesNotMatch(qa, /login\/logout tested manually/);
  assert.doesNotMatch(qa, /setTimeout\(\(\) => void runChecks/);
});

test("market context does not leak provider credentials or fabricate missing core quotes", () => {
  const route = source("app/api/market-context/route.ts");
  assert.match(route, /Authorization: `Bearer \$\{key\}`/);
  assert.doesNotMatch(route, /apiKey=/);
  assert.match(route, /if \(!spy \|\| !qqq \|\| !iwm\) throw/);
  assert.doesNotMatch(route, /spy \?\? \{ price: 0/);
  assert.match(route, /checkDurableApiRateLimit/);
  assert.match(route, /recordExternalRequestTelemetry/);
});

test("mutating account, Agent, Paper, and watchlist operations retain owner boundaries", () => {
  const account = source("app/api/account/route.ts");
  const agent = source("app/api/ht-agent/route.ts");
  const paper = source("app/api/paper-trading/orders/route.ts");
  const watchlist = source("supabase/migrations/0049_secure_ht_labs_watchlist.sql");
  assert.match(account, /authClient\.auth\.getUser\(accessToken\)/);
  assert.match(account, /\.eq\("user_id", authData\.user\.id\)/);
  assert.match(agent, /authenticatePaperRequest\(request\)/);
  assert.match(agent, /if \(!context\).*Authentication required/);
  assert.match(paper, /authenticatePaperRequest\(request\)/);
  assert.match(watchlist, /force row level security/i);
  assert.match(watchlist, /auth\.uid\(\)\) = user_id/i);
});
