import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { evaluateCryptoAssetPolicy, isAllowedMainstreamCryptoAsset } from "./asset-policy.ts";

test("excludes stable, wrapped, receipt, leveraged, and empty assets", () => {
  assert.equal(evaluateCryptoAssetPolicy("USDC").reason, "stable_asset");
  assert.equal(evaluateCryptoAssetPolicy("WBTC").reason, "wrapped_or_receipt_asset");
  assert.equal(evaluateCryptoAssetPolicy("ETH3L").reason, "leveraged_asset");
  assert.equal(evaluateCryptoAssetPolicy("  ").reason, "invalid_asset");
});

test("keeps ordinary mainstream symbols available", () => {
  for (const symbol of ["BTC", "ETH", "SOL", "DOGE", "PEPE", "1INCH"]) {
    assert.equal(isAllowedMainstreamCryptoAsset(symbol), true, symbol);
  }
});
