import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const original = readFileSync(
  new URL("../supabase/migrations/0063_session_continuity_shadow.sql", import.meta.url),
  "utf8",
).toLowerCase();
const repair = readFileSync(
  new URL(
    "../supabase/migrations/0065_session_continuity_persistence_repair.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

test("0065 removes the model_version PL/pgSQL ambiguity from 0063", () => {
  assert.match(original, /model_version text := p_receipt->>'version'/);
  assert.match(original, /e\.model_version = model_version/);

  assert.doesNotMatch(repair, /\n\s*model_version text :=/);
  assert.match(repair, /v_model_version text := p_receipt->>'version'/);
  assert.match(repair, /e\.model_version = v_model_version/);
  assert.match(repair, /on conflict\(trading_date, ticker, model_version\) do nothing/);
});

test("0065 remains forward-only, research-only, and provider-neutral", () => {
  assert.match(repair, /create or replace function public\.ht_record_session_continuity_episode/);
  assert.doesNotMatch(repair, /drop table|truncate|delete from|update public\.ht_session_continuity/);
  assert.match(repair, /'providerrequestsadded', 0/);
  assert.match(repair, /'authority', 'research_only'/);
  assert.doesNotMatch(repair, /cron\.|net\.http|polygon|massive/);
});
