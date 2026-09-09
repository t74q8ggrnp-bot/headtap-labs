import { randomUUID } from "node:crypto";
// @ts-expect-error Node's strip-types test runner requires source extensions.
import { CRYPTO_PRODUCT_CAPABILITIES, assertCryptoCapabilitiesEnabled, type CryptoProductCapabilities } from "./product-capabilities.ts";

export type PilotUsageLedger = {
  reserve(id: string, path: string): Promise<boolean>;
  settle(id: string, cost: number | null, status: number): Promise<boolean>;
};

/** Every provider request needs a durable reservation, including metadata and failures. */
export function budgetedCoinApiFetch(ledger: PilotUsageLedger, fetcher: typeof fetch = fetch,
  now = Date.now,
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES): typeof fetch {
  const startedAt = now();
  let stopped = false;
  return async (input, init) => {
    assertCryptoCapabilitiesEnabled(
      "coinApiResearchCollectionEnabled",
      capabilities,
    );
    const url = new URL(String(input));
    if (url.origin !== "https://rest.coinapi.io" || stopped || now() - startedAt > 40_000) {
      throw new Error("CoinAPI pilot request blocked.");
    }
    const id = randomUUID();
    // Never retry an uncertain database reservation: it may already be committed.
    let reserved = false;
    try { reserved = await ledger.reserve(id, url.pathname + url.search); }
    catch { stopped = true; throw new Error("CoinAPI reservation uncertain; collection stopped."); }
    if (!reserved) {
      stopped = true;
      throw new Error("CoinAPI pilot allowance unavailable.");
    }
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(12_000);
      response = await fetcher(url, { ...init, redirect: "error", cache: "no-store",
        signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } catch {
      stopped = true;
      await ledger.settle(id, null, 0);
      throw new Error("CoinAPI response uncertain; collection stopped.");
    }
    const header = response.headers.get("x-ratelimit-request-cost");
    const number = header?.trim() ? Number(header) : NaN;
    const cost = Number.isFinite(number) && number >= 0 ? number : null;
    let allowed = false;
    try { allowed = await ledger.settle(id, cost, response.status); }
    catch { stopped = true; throw new Error("CoinAPI usage accounting unavailable."); }
    if (!allowed || cost === null || cost > 1 || [401, 403, 429].includes(response.status)) {
      stopped = true;
      throw new Error("CoinAPI cost or entitlement requires review.");
    }
    return response;
  };
}
