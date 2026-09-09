import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/0050_phase1_workspace_infrastructure_verification.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

test("Phase 1 infrastructure verification is read-only and service-only", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /stable\s+security definer/);
  assert.match(migration, /migration0048/);
  assert.match(migration, /migration0049/);
  assert.match(migration, /phase1-workspace-infrastructure-v1/);
  assert.match(migration, /count\(\*\) = 6 and pg_catalog\.bool_and/);
  assert.match(migration, /ht_stock_display_frames_symbol_check/);
  assert.match(migration, /ht_stock_display_frames_frame_bucket_check/);
  assert.match(migration, /ht_stock_display_frames_price_check/);
  assert.match(migration, /ht_stock_display_frames_source_check/);
  assert.match(migration, /ht_stock_display_frames_price_kind_check/);
  assert.match(migration, /ht_stock_display_frames_trade_size_check/);
  assert.match(migration, /pg_catalog\.pg_get_functiondef/);
  assert.match(migration, /and not p\.proretset/);
  assert.match(migration, /and p\.prokind = 'f'/);
  assert.match(migration, /publish_owner_oid = display_owner_oid/);
  assert.match(migration, /not c\.relforcerowsecurity/);
  assert.match(migration, /not coalesce\(case p\.polname/);
  assert.match(migration, /jsonb_to_recordset'\) = 0/);
  assert.match(
    migration,
    /c\.confkey = array\[auth_user_id_attnum\]::smallint\[\]/,
  );
  assert.match(migration, /p\.polroles <> array\[authenticated_oid\]::oid\[\]/);
  assert.match(migration, /policy_expression\.qual_normalized = 'auth\.uid=user_id'/);
  assert.match(migration, /policy_expression\.check_normalized = 'auth\.uid=user_id'/);
  assert.match(
    migration,
    /revoke all on function public\.ht_phase1_workspace_infrastructure_health\(\)[\s\S]*from public, anon, authenticated, service_role;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.ht_phase1_workspace_infrastructure_health\(\)[\s\S]*to service_role;/,
  );
  assert.doesNotMatch(migration, /\binsert\s+into\b/);
  assert.doesNotMatch(migration, /\bupdate\s+public\./);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/);
  assert.doesNotMatch(
    migration,
    /has_table_privilege\([^)]*'(?:select|insert|update|delete|truncate|references|trigger)\s*,/,
  );
  for (const privilege of [
    "select",
    "insert",
    "update",
    "delete",
    "truncate",
    "references",
    "trigger",
  ]) {
    assert.match(migration, new RegExp(`has_table_privilege\\([^)]*'${privilege}'`));
  }
  assert.match(migration, /commit;\s*$/);
});
