import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/0049_secure_ht_labs_watchlist.sql",
    import.meta.url,
  ),
  "utf8",
);
const normalized = migration.toLowerCase();

test("watchlist security migration preflights before its first schema alteration", () => {
  const schemaPreflight = normalized.indexOf("$watchlist_schema_preflight$");
  const dataPreflight = normalized.indexOf("$watchlist_data_preflight$");
  const firstAlter = normalized.indexOf("alter table");

  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;\s*$/);
  assert.ok(schemaPreflight >= 0);
  assert.ok(dataPreflight > schemaPreflight);
  assert.ok(firstAlter > dataPreflight);
  assert.ok(
    normalized.indexOf("lock table public.ht_labs_watchlist") < dataPreflight,
  );

  for (const requiredPreflight of [
    "must already be uuid",
    "symbol must already be text",
    "null user_id",
    "null symbol",
    "invalid or non-uppercase symbols",
    "duplicate (user_id, symbol)",
    "reference missing auth.users",
  ]) {
    assert.ok(
      normalized.includes(requiredPreflight),
      `missing preflight: ${requiredPreflight}`,
    );
  }
});

test("watchlist security migration never repairs or rewrites membership rows", () => {
  assert.doesNotMatch(
    normalized,
    /\bdelete\s+from\s+public\.ht_labs_watchlist\b/,
  );
  assert.doesNotMatch(
    normalized,
    /\bupdate\s+public\.ht_labs_watchlist\b/,
  );
  assert.doesNotMatch(
    normalized,
    /\binsert\s+into\s+public\.ht_labs_watchlist\b/,
  );
  assert.doesNotMatch(normalized, /alter\s+column\s+user_id\s+type/);
  assert.doesNotMatch(normalized, /alter\s+column\s+symbol\s+type/);
});

test("watchlist security migration installs the exact owner contract", () => {
  assert.match(
    normalized,
    /constraint ht_labs_watchlist_user_id_symbol_key\s+unique \(user_id, symbol\)/,
  );
  assert.match(
    normalized,
    /constraint ht_labs_watchlist_user_id_fkey\s+foreign key \(user_id\) references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    normalized,
    /constraint ht_labs_watchlist_symbol_format_check[\s\S]*symbol = pg_catalog\.upper\(symbol\)/,
  );
  assert.match(
    normalized,
    /alter table public\.ht_labs_watchlist enable row level security;/,
  );
  assert.match(
    normalized,
    /alter table public\.ht_labs_watchlist force row level security;/,
  );

  const policies = normalized.match(
    /create policy ht_labs_watchlist_owner_(select|insert|update|delete)/g,
  );
  assert.equal(policies?.length, 4);
  const ownerPredicates = normalized.match(
    /\(\(select auth\.uid\(\)\) = user_id\)/g,
  );
  assert.equal(ownerPredicates?.length, 5);
  assert.match(
    normalized,
    /for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\);/,
  );
  assert.match(
    normalized,
    /for insert\s+to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id\);/,
  );
  assert.match(
    normalized,
    /for update\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\);/,
  );
  assert.match(
    normalized,
    /for delete\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\);/,
  );
  assert.match(normalized, /select pol\.polname[\s\S]*drop policy %i/);
  assert.match(normalized, /pg_catalog\.aclexplode/);
  assert.doesNotMatch(
    normalized,
    /aclexplode\(\s*coalesce\([^)]*'\{\}'::pg_catalog\.aclitem\[\]/,
  );
  assert.match(
    normalized,
    /grant select, insert, update, delete on table public\.ht_labs_watchlist\s+to authenticated;/,
  );
  assert.match(
    normalized,
    /grant all privileges on table public\.ht_labs_watchlist\s+to service_role;/,
  );
  assert.match(
    normalized,
    /revoke all privileges on table public\.ht_labs_watchlist\s+from public, anon, authenticated, service_role cascade;/,
  );
  assert.match(normalized, /\$watchlist_contract_postflight\$/);
});
