import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/0062_live_market_score_beta.sql", import.meta.url),
  "utf8",
).toLowerCase();
const server = readFileSync(
  new URL("./market-score-server.ts", import.meta.url),
  "utf8",
);
const card = readFileSync(
  new URL("../app/components/agent/AgentMarketAnalysisCard.tsx", import.meta.url),
  "utf8",
);

test("0062 installs immutable minute receipts with no trading authority", () => {
  assert.match(migration, /\nbegin;/);
  assert.match(migration, /unique \(symbol, model_version, observed_bucket\)/);
  assert.match(migration, /on conflict\(symbol, model_version, observed_bucket\) do nothing/);
  assert.match(migration, /"canonical":false/);
  assert.match(migration, /"prox":false/);
  assert.match(migration, /"agentrisk":false/);
  assert.match(migration, /"paper":false/);
  assert.match(migration, /"execution":false/);
  assert.match(migration, /'providerrequestsadded', 0/);
  assert.doesNotMatch(migration, /cron\.|net\.http|polygon|massive/);
});

test("0062 keeps the ledger service-only and exposes bounded research health", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.ht_market_score_observations from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.ht_market_score_observations to service_role/);
  assert.match(migration, /ht_market_score_beta_health/);
  assert.match(migration, /'authority', 'research_only'/);
  assert.match(migration, /'primaryproductimpact', false/);
  assert.match(migration, /'5m'/);
  assert.match(migration, /'15m'/);
  assert.match(migration, /'60m'/);
  assert.match(migration, /commit;\s*$/);
});

test("the live score reuses chart evidence and the browser only formats persisted receipts", () => {
  assert.match(server, /calculateHtMarketScore\(\{ bars, quote, assetKind \}\)/);
  assert.match(server, /rpc\("ht_record_market_score_frame"/);
  assert.doesNotMatch(server, /fetchMassiveInstrument|polygon\.io|api\.polygon/);
  assert.match(card, /chart\?\.marketScore/);
  assert.doesNotMatch(card, /calculateHtMarketScore|\/api\/instruments/);
});
