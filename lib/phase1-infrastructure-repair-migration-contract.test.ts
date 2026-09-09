import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/0051_repair_phase1_workspace_verification.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

test("0051 repairs only the failed Phase 1 infrastructure catalog boundaries", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /phase1_repair_preflight/);
  assert.match(migration, /display_acl_repair/);
  assert.match(migration, /repair_phase1_verifier/);
  assert.match(migration, /phase1_repair_postflight/);
  assert.match(migration, /pg_catalog\.aclexplode\(c\.relacl\)/);
  assert.match(migration, /pg_catalog\.aclexplode\(a\.attacl\)/);
  assert.match(
    migration,
    /revoke all privileges \(%i\) on table public\.ht_stock_display_frames/,
  );
  assert.match(
    migration,
    /grant select on table public\.ht_stock_display_frames to service_role/,
  );
  assert.match(migration, /exact watchlist owner\+symbol constraint/);
  assert.match(migration, /exact watchlist auth\.users foreign key/);
  assert.match(migration, /exact watchlist ticker-format constraint/);
  assert.match(
    migration,
    /'symbol=uppersymbolandsymbol~''\^\[a-z0-9\]/,
  );
  assert.match(migration, /bad_fragment_count <> 2/);
  assert.match(
    migration,
    /coalesce\(\(repaired_health #>> '\{migration0048,verified\}'\)::boolean, false\) is not true/,
  );
  assert.match(
    migration,
    /coalesce\(\(repaired_health #>> '\{migration0049,verified\}'\)::boolean, false\) is not true/,
  );
  assert.doesNotMatch(
    migration,
    /alter table public\.ht_labs_watchlist[\s\S]*(?:add|drop) constraint/,
  );
  assert.doesNotMatch(migration, /\binsert\s+into\b/);
  assert.doesNotMatch(migration, /\bupdate\s+public\./);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/);
  assert.match(migration, /commit;\s*$/);
});
