// Injectable transport for bounded diagnostics and the server-only provider adapter.
// No endpoints accept an arbitrary origin and no response exposes the credential.
export function createCoinApiClient({
  apiKey,
  fetcher = fetch,
  now = Date.now,
  maxRequests = 12,
}: {
  apiKey: string;
  fetcher?: typeof fetch;
  now?: () => number;
  maxRequests?: number;
}) {
  if (!apiKey.trim()) throw new Error("CoinAPI is not configured.");
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 5_000) {
    throw new Error("A bounded CoinAPI request allowance is required.");
  }
  let requests = 0;
  let reportedCredits = 0;
  let unreportedCosts = 0;
  let blocked = false;
  const cache = new Map<string, { expiresAt: number; payload: unknown }>();
  const pending = new Map<string, Promise<unknown>>();

  async function get(path: string, ttlMs = 0): Promise<unknown> {
    if (!/^\/v1\/(?:symbols(?:\/|\?|$)|(?:trades|quotes|ohlcv)\/)/.test(path) ||
        /[\\\r\n]/.test(path) || /(?:api.?key|token)=/i.test(path)) {
      throw new Error("Unsupported CoinAPI data path.");
    }
    const url = new URL(path, "https://rest.coinapi.io");
    if (url.origin !== "https://rest.coinapi.io" || url.username || url.password || url.hash) {
      throw new Error("Unsupported CoinAPI origin.");
    }
    const cached = cache.get(path);
    if (cached && cached.expiresAt > now()) return structuredClone(cached.payload);
    if (pending.has(path)) return structuredClone(await pending.get(path));
    if (blocked) throw new Error("CoinAPI access is blocked; check credits and entitlement before retrying.");
    if (requests >= maxRequests) throw new Error("CoinAPI diagnostic request allowance reached.");
    requests++;
    const work = (async () => {
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { "X-CoinAPI-Key": apiKey, Accept: "application/json" },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error("CoinAPI connection failed.");
      }
      const costHeader = response.headers.get("x-ratelimit-request-cost");
      const cost = costHeader === null ? NaN : Number(costHeader);
      if (Number.isFinite(cost) && cost >= 0) reportedCredits += cost;
      else unreportedCosts++;
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) blocked = true;
        // Never echo a provider error body which might contain authentication data.
        throw new Error(`CoinAPI data request failed (${response.status}).`);
      }
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new Error("CoinAPI returned malformed market data."); }
      if (ttlMs > 0) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        cache.set(path, { expiresAt: now() + Math.min(ttlMs, 3_600_000), payload });
      }
      return payload;
    })();
    pending.set(path, work);
    try { return structuredClone(await work); }
    finally { pending.delete(path); }
  }

  return {
    get,
    usage: () => ({ requests, maxRequests, reportedCredits, unreportedCosts, blocked }),
  };
}
