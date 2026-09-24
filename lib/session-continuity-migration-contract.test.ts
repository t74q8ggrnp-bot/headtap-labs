import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/0063_session_continuity_shadow.sql", import.meta.url),
  "utf8",
).toLowerCase();
const collector = readFileSync(
  new URL("../app/api/opportunity-ledger/route.ts", import.meta.url),
  "utf8",
);

test("0063 installs immutable deduplicated continuity episodes with no authority", () => {
  assert.match(migration, /unique \(trading_date, ticker, model_version\)/);
  assert.match(migration, /before update or delete/);
  assert.match(migration, /"canonical":false/);
  assert.match(migration, /"prox":false/);
  assert.match(migration, /"agentrisk":false/);
  assert.match(migration, /"paper":false/);
  assert.match(migration, /"execution":false/);
  assert.match(migration, /eligible_for_graduation/);
  assert.match(migration, /spot\.first_seen_at <= source_row\.first_seen_at/);
});

test("0063 measures the approved early horizons and premarket graduation honestly", () => {
  for (const horizon of ["15m", "30m", "45m", "60m", "market_open", "open_plus_30m"]) {
    assert.match(migration, new RegExp(`'${horizon}'`));
  }
  assert.match(migration, /status in \('pending','partial','complete','unavailable'\)/);
  assert.match(migration, /at time zone 'america\/new_york'/);
  assert.match(migration, /'providerrequestsadded',0/);
  assert.doesNotMatch(migration, /cron\.|net\.http|polygon|massive/);
});

test("the existing opportunity collector owns persistence without adding a provider loop", () => {
  assert.match(collector, /ht_record_session_continuity_episode/);
  assert.match(collector, /ht_reconcile_session_continuity_outcomes/);
  assert.match(collector, /providerRequestsAdded: 0/);
  assert.equal(collector.match(/fetchMinuteBars\(/g)?.length, 2);
});
