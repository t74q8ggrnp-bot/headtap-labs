export const ACCOUNT_DELETE_CONFIRMATION = "DELETE";

export const ACCOUNT_LOCAL_STORAGE_KEYS = [
  "headtap-watchlist",
  "htlabs-saved-setups",
  "htlabs-viewed-tickers",
] as const;

export const ACCOUNT_USER_DATA_TABLES = [
  "ht_labs_watchlist",
  "ht_signal_memory",
  "ht_market_behavior",
] as const;

export function readBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

export function isConfirmedAccountDeletion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    "confirmation" in value &&
    value.confirmation === ACCOUNT_DELETE_CONFIRMATION
  );
}

export function isMissingPersonalDataTable(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}
