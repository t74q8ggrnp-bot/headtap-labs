/** Public-safe diagnostics: never return database messages, details, URLs or keys. */
export function cryptoStorageDiagnostic(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = typeof value.code === "string" ? value.code : "";
  const code = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(rawCode) ? rawCode : null;
  const timeout = code === "57014" || value.name === "TimeoutError" || value.name === "AbortError";
  const kind = timeout ? "timeout" : code === "42501" ? "permission_denied"
    : ["42P01", "42883", "42703", "PGRST202", "PGRST205"].includes(code ?? "") ? "schema_unavailable"
      : code ? "database_error" : "storage_unavailable";
  return { code, kind };
}

export class CryptoStorageError extends Error {
  readonly diagnostic: ReturnType<typeof cryptoStorageDiagnostic>;
  readonly stage: "maintenance" | "usage_recovery" | "claim" | "reservation" | "receipt" | "publication";
  constructor(stage: CryptoStorageError["stage"], error: unknown) {
    super(`CoinAPI storage operation failed at ${stage}.`);
    this.stage = stage;
    this.diagnostic = cryptoStorageDiagnostic(error);
  }
}
