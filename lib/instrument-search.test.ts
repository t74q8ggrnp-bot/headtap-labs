import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { clearInstrumentSearchCachesForTests, fetchMassiveInstrument, InstrumentSearchError, normalizeInstrumentSearchQuery, normalizeInstrumentSymbol, rankInstrumentResults, searchMassiveInstruments } from "./instrument-search.ts";

const instrument = (
  symbol: string,
  name: string,
  overrides: Record<string, unknown> = {},
) => ({
  symbol,
  name,
  market: "stocks",
  locale: "us",
  primaryExchange: "XNAS",
  securityType: "CS",
  assetKind: "stock" as const,
  active: true,
  currency: "usd",
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  providerUpdatedAt: null,
  workspaceSupported: true,
  provider: "massive_polygon" as const,
  ...overrides,
});

test("instrument input normalization accepts tickers and rejects malformed input", () => {
  assert.equal(normalizeInstrumentSymbol(" $brk.b "), "BRK.B");
  assert.equal(normalizeInstrumentSymbol("ABCDEFGHIJK"), null);
  assert.equal(normalizeInstrumentSymbol("AAPL<script>"), null);
  assert.equal(normalizeInstrumentSearchQuery("  Berkshire   Hathaway "), "Berkshire Hathaway");
  assert.equal(normalizeInstrumentSearchQuery("f"), "f");
  assert.equal(normalizeInstrumentSearchQuery("<"), null);
});

test("search ranking orders exact ticker, ticker prefix, and company-name matches", () => {
  const ranked = rankInstrumentResults("SP", [
    instrument("XSP", "Mini SP Index"),
    instrument("SP", "SP Plus Corporation"),
    instrument("SPY", "SPDR S&P 500 ETF Trust", { securityType: "ETF", assetKind: "etf" }),
    instrument("ALT", "SP Holdings"),
    instrument("SPY", "Duplicate SPY"),
    instrument("NOPE", "Other", { workspaceSupported: false }),
  ]);
  assert.deepEqual(ranked.map((row) => row.symbol), ["SP", "SPY", "ALT", "XSP"]);
  assert.equal(ranked[1]?.assetKind, "etf");
});

test("Massive search is US-stock scoped, supports ETFs, and caches successful metadata", async () => {
  clearInstrumentSearchCachesForTests();
  const urls: URL[] = [];
  const fetcher = async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    return Response.json({
      results: [
        { ticker: "SPY", name: "SPDR S&P 500 ETF Trust", market: "stocks", locale: "us", type: "ETF", active: true },
        { ticker: "SPYG", name: "SPDR Portfolio S&P 500 Growth ETF", market: "stocks", locale: "us", type: "ETF", active: true },
        { ticker: "SPY.WS", name: "Example Warrant", market: "stocks", locale: "us", type: "WARRANT", active: true },
      ],
    });
  };
  const first = await searchMassiveInstruments("spy", {
    apiKey: "server-secret",
    fetcher: fetcher as typeof fetch,
    now: 1_700_000_000_000,
  });
  const second = await searchMassiveInstruments("SPY", {
    apiKey: "server-secret",
    fetcher: fetcher as typeof fetch,
    now: 1_700_000_001_000,
  });

  assert.equal(urls.length, 1);
  assert.equal(urls[0]?.pathname, "/v3/reference/tickers");
  assert.equal(urls[0]?.searchParams.get("market"), "stocks");
  assert.equal(urls[0]?.searchParams.get("locale"), "us");
  assert.equal(urls[0]?.searchParams.get("active"), "true");
  assert.equal(urls[0]?.searchParams.get("apiKey"), "server-secret");
  assert.equal(first.results[0]?.symbol, "SPY");
  assert.equal(first.results[0]?.assetKind, "etf");
  assert.equal(first.results.some((row) => row.symbol === "SPY.WS"), false);
  assert.equal(first.cacheState, "instance_miss");
  assert.equal(second.cacheState, "instance_hit");
});

test("concurrent identical searches share one provider request", async () => {
  clearInstrumentSearchCachesForTests();
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = async () => {
    calls += 1;
    await barrier;
    return Response.json({ results: [
      { ticker: "AAPL", name: "Apple Inc.", market: "stocks", locale: "us", type: "CS", active: true },
    ] });
  };
  const first = searchMassiveInstruments("apple", { apiKey: "key", fetcher: fetcher as typeof fetch });
  const second = searchMassiveInstruments("APPLE", { apiKey: "key", fetcher: fetcher as typeof fetch });
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(left.cacheState, "instance_miss");
  assert.equal(right.cacheState, "shared_inflight");
});

test("detail lookup preserves inactive state instead of claiming workspace availability", async () => {
  clearInstrumentSearchCachesForTests();
  const response = await fetchMassiveInstrument("QQQ", {
    apiKey: "key",
    fetcher: (async () => Response.json({
      results: {
        ticker: "QQQ",
        name: "Invesco QQQ Trust",
        market: "stocks",
        locale: "us",
        type: "ETF",
        active: false,
      },
    })) as typeof fetch,
    now: 1_700_000_000_000,
  });
  assert.equal(response.instrument.assetKind, "etf");
  assert.equal(response.instrument.active, false);
  assert.equal(response.instrument.workspaceSupported, false);
});

test("direct detail lookup keeps warrants outside the stock-and-ETF workspace", async () => {
  clearInstrumentSearchCachesForTests();
  const response = await fetchMassiveInstrument("SPY.WS", {
    apiKey: "key",
    fetcher: (async () => Response.json({
      results: {
        ticker: "SPY.WS",
        name: "SPY Test Warrant",
        market: "stocks",
        locale: "us",
        type: "WARRANT",
        active: true,
      },
    })) as typeof fetch,
    now: 1_700_000_000_000,
  });
  assert.equal(response.instrument.active, true);
  assert.equal(response.instrument.assetKind, "other");
  assert.equal(response.instrument.workspaceSupported, false);
});

test("missing provider active state stays unavailable", async () => {
  clearInstrumentSearchCachesForTests();
  const response = await fetchMassiveInstrument("QQQ", {
    apiKey: "key",
    fetcher: (async () => Response.json({
      results: {
        ticker: "QQQ",
        name: "Invesco QQQ Trust",
        market: "stocks",
        locale: "us",
        type: "ETF",
      },
    })) as typeof fetch,
    now: 1_700_000_000_000,
  });
  assert.equal(response.instrument.active, false);
  assert.equal(response.instrument.workspaceSupported, false);
});

test("provider failures remain typed and are not cached as empty results", async () => {
  clearInstrumentSearchCachesForTests();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return Response.json({ error: "upstream unavailable" }, { status: 503 });
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      searchMassiveInstruments("tesla", { apiKey: "key", fetcher: fetcher as typeof fetch }),
      (error: unknown) => error instanceof InstrumentSearchError && error.code === "provider_unavailable",
    );
  }
  assert.equal(calls, 2);
});
