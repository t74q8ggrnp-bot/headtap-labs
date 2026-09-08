// Bounded, read-only web API comparison. No account/order endpoints and no
// CoinAPI requests. A mobile User-Agent is NOT a physical-device UI test.
import assert from "node:assert/strict";

const origin = process.argv[2] ?? "https://gethtlabs.com";
const symbol = process.argv[3] ?? "CHPT";
if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin) || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
  throw Error("Expected HTTPS origin and stock symbol");
}
const desktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0";
const mobile = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
async function read(label, path, init = {}) {
  const startedAt = new Date();
  const response = await fetch(`${origin}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const receivedAt = new Date();
  if (!response.ok) throw Error(`${label}: HTTP ${response.status}`);
  const body = await response.json();
  const value = body.displayQuote ?? body.quotes?.[symbol] ?? { ...body, price: body.c };
  const result = { client: label, price: value.price, asOf: value.asOf, priceKind: value.priceKind,
    frameId: value.frameId ?? value.displayFrame?.id ?? body.displayFrame?.id ?? null,
    frameCoordination: value.frameCoordination ?? value.displayFrame?.coordination ?? body.displayFrame?.coordination ?? null,
    frameCoordinationIssue: value.frameCoordinationIssue ?? value.displayFrame?.issue ?? body.displayFrame?.issue ?? null,
    live: value.live, startedAt: startedAt.toISOString(), receivedAt: receivedAt.toISOString(),
    providerAgeMs: receivedAt.getTime() - Date.parse(value.asOf), candleClose: body.bars?.at(-1)?.close,
    summaryClose: body.summary?.close };
  assert.ok(result.price > 0 && Number.isFinite(result.providerAgeMs), `${label}: valid price/time required`);
  assert.ok(result.providerAgeMs >= -2000, `${label}: future price`);
  assert.ok(["trade", "minute_aggregate"].includes(result.priceKind), `${label}: new display contract missing`);
  if (body.bars) {
    assert.equal(result.price, result.candleClose, `${label}: quote/candle mismatch`);
    assert.equal(result.price, result.summaryClose, `${label}: quote/summary mismatch`);
  }
  return result;
}
// Start just after a shared wall-clock boundary so network jitter cannot turn
// a valid deployment into an adjacent-frame false failure.
const boundaryDelayMs = 5_000 - (Date.now() % 5_000) + 100;
await new Promise(resolve => setTimeout(resolve, boundaryDelayMs));
const results = await Promise.all([
  read("desktop chart API", `/api/market-chart?asset=stock&symbol=${symbol}`, { headers: { "User-Agent": desktop } }),
  read("mobile chart API", `/api/market-chart?asset=stock&symbol=${symbol}`, { headers: { "User-Agent": mobile } }),
  read("quote list API", "/api/bulk-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: [symbol] }) }),
  read("single quote API", `/api/quote?symbol=${symbol}`),
]);
const conflicts = results.flatMap((a, i) => results.slice(i + 1).filter(b => a.asOf === b.asOf && a.price !== b.price)
  .map(b => ({ a: a.client, b: b.client, at: a.asOf, prices: [a.price, b.price] })));
console.log(JSON.stringify({ symbol, results, sameTimestampPriceConflicts: conflicts,
  note: "All simultaneous stock presentation endpoints must reuse one database-coordinated Massive provider event." }, null, 2));
assert.equal(conflicts.length, 0, "Same provider timestamp returned different prices");
const frameIds = new Set(results.map(result => result.frameId).filter(Boolean));
assert.ok(results.every(result => result.frameId), "Shared display frame metadata is required");
assert.equal(frameIds.size, 1, "Simultaneous desktop/mobile/chart/quote reads must share one display frame");
assert.ok(results.every(result => result.frameCoordination === "database"),
  "Migration 0048 database coordination is required; an instance-only fallback is not cross-device proof");
