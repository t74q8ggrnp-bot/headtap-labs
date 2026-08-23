import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { ACCOUNT_DELETE_CONFIRMATION, ACCOUNT_LOCAL_STORAGE_KEYS, ACCOUNT_USER_DATA_TABLES, isConfirmedAccountDeletion, isMissingPersonalDataTable, readBearerToken } from "./account-deletion.ts";

test("readBearerToken accepts a bearer token and rejects other schemes", () => {
  assert.equal(readBearerToken("Bearer valid-token"), "valid-token");
  assert.equal(readBearerToken("bearer   spaced-token "), "spaced-token");
  assert.equal(readBearerToken("Basic invalid"), null);
  assert.equal(readBearerToken(null), null);
});

test("account deletion requires the exact explicit confirmation", () => {
  assert.equal(
    isConfirmedAccountDeletion({ confirmation: ACCOUNT_DELETE_CONFIRMATION }),
    true,
  );
  assert.equal(isConfirmedAccountDeletion({ confirmation: "delete" }), false);
  assert.equal(isConfirmedAccountDeletion({}), false);
  assert.equal(isConfirmedAccountDeletion(null), false);
});

test("the deletion manifest is limited to known personal data", () => {
  assert.deepEqual(ACCOUNT_USER_DATA_TABLES, [
    "ht_labs_watchlist",
    "ht_signal_memory",
    "ht_market_behavior",
  ]);
  assert.deepEqual(ACCOUNT_LOCAL_STORAGE_KEYS, [
    "headtap-watchlist",
    "htlabs-saved-setups",
    "htlabs-viewed-tickers",
  ]);
  assert.equal(isMissingPersonalDataTable("PGRST205"), true);
  assert.equal(isMissingPersonalDataTable("42P01"), true);
  assert.equal(isMissingPersonalDataTable("42501"), false);
});
