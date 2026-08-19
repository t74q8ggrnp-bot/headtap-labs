export const CRYPTO_STABLE_ASSETS = new Set([
  "BUSD",
  "DAI",
  "EURC",
  "FDUSD",
  "FRAX",
  "GUSD",
  "PAX",
  "PYUSD",
  "TUSD",
  "USDC",
  "USDP",
  "USDS",
  "USDT",
]);

// Receipt, wrapped, and bridge representations are deliberately excluded from
// the mainstream crypto lane. This list is intentionally explicit: broad
// prefix/suffix matching would incorrectly reject legitimate assets such as
// JUP or WIF.
export const CRYPTO_WRAPPED_OR_RECEIPT_ASSETS = new Set([
  "ANKRETH",
  "CBETH",
  "MSOL",
  "RETH",
  "STETH",
  "WBETH",
  "WBTC",
  "WETH",
  "WSTETH",
]);

const LEVERAGED_SUFFIX = /(?:2L|2S|3L|3S|5L|5S)$/;

export type CryptoAssetPolicyResult = {
  allowed: boolean;
  reason: "allowed" | "stable_asset" | "wrapped_or_receipt_asset" | "leveraged_asset";
};

export function evaluateCryptoAssetPolicy(symbolValue: unknown): CryptoAssetPolicyResult {
  const symbol = String(symbolValue ?? "").trim().toUpperCase();
  if (CRYPTO_STABLE_ASSETS.has(symbol)) {
    return { allowed: false, reason: "stable_asset" };
  }
  if (CRYPTO_WRAPPED_OR_RECEIPT_ASSETS.has(symbol)) {
    return { allowed: false, reason: "wrapped_or_receipt_asset" };
  }
  if (symbol.length > 3 && LEVERAGED_SUFFIX.test(symbol)) {
    return { allowed: false, reason: "leveraged_asset" };
  }
  return { allowed: true, reason: "allowed" };
}

export function isAllowedMainstreamCryptoAsset(symbol: unknown) {
  return evaluateCryptoAssetPolicy(symbol).allowed;
}
