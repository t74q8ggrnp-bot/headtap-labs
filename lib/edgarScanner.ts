// ─────────────────────────────────────────────────────────────
//  lib/edgarScanner.ts
//  SEC EDGAR Form 4 — insider buy scanner
//  No API key needed. All public SEC data.
//  Drop this file into your /lib folder.
// ─────────────────────────────────────────────────────────────

export interface InsiderBuy {
  ticker: string;
  insiderName: string;
  filedDate: string;
  daysAgo: number;
  totalValue: number;   // 0 if not parseable from RSS
  formUrl: string;
}

// Cache to avoid hammering EDGAR on every request
const edgarCache = new Map<string, { data: InsiderBuy[]; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const EDGAR_RSS =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=40&search_text=&output=atom";

// ── Fetch recent Form 4 filings from EDGAR RSS ──────────────
async function fetchEdgarRSS(): Promise<InsiderBuy[]> {
  const cached = edgarCache.get("rss");
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(EDGAR_RSS, {
      headers: { "User-Agent": "HTLabs signal-engine@htlabs.com" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const filings = parseRSS(xml);
    edgarCache.set("rss", { data: filings, ts: Date.now() });
    return filings;
  } catch {
    return [];
  }
}

function parseRSS(xml: string): InsiderBuy[] {
  const entries = xml.split("<entry>").slice(1);
  const now = Date.now();
  const results: InsiderBuy[] = [];

  for (const entry of entries) {
    try {
      const title = extractTag(entry, "title") ?? "";
      const updated = extractTag(entry, "updated") ?? "";
      const link = extractTag(entry, "id") ?? "";

      // Title: "4 - COMPANY NAME (TICKER) (CIK) (Issuer)"
      const tickerMatch = title.match(/\(([A-Z]{1,5})\)/);
      if (!tickerMatch) continue;

      const ticker = tickerMatch[1];
      const filedDate = updated.split("T")[0] ?? "";
      const daysAgo = filedDate
        ? Math.max(0, Math.floor((now - new Date(filedDate).getTime()) / 86_400_000))
        : 99;

      // Only keep filings from last 14 days
      if (daysAgo > 14) continue;

      results.push({
        ticker,
        insiderName: "",
        filedDate,
        daysAgo,
        totalValue: 0,
        formUrl: link,
      });
    } catch {
      continue;
    }
  }

  return results;
}

// ── Public API: check a list of tickers for insider buys ─────
export async function getInsiderBuysForTickers(
  tickers: string[]
): Promise<Map<string, InsiderBuy>> {
  const allFilings = await fetchEdgarRSS();
  const result = new Map<string, InsiderBuy>();

  for (const ticker of tickers) {
    const upper = ticker.toUpperCase();
    const match = allFilings.find((f) => f.ticker === upper);
    if (match) result.set(ticker, match);
  }

  return result;
}

// ── EFTS full-text search for a specific ticker (more precise) ─
export async function searchEdgarForTicker(ticker: string): Promise<InsiderBuy | null> {
  const cacheKey = `ticker-${ticker}`;
  const cached = edgarCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data[0] ?? null;

  try {
    const today = isoDate(0);
    const past30 = isoDate(30);
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=4&dateRange=custom&startdt=${past30}&enddt=${today}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "HTLabs signal-engine@htlabs.com" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const hits = data?.hits?.hits ?? [];
    if (!hits.length) return null;

    const src = hits[0]._source ?? {};
    const filedDate = src.file_date ?? "";
    const daysAgo = filedDate
      ? Math.max(0, Math.floor((Date.now() - new Date(filedDate).getTime()) / 86_400_000))
      : 99;

    const filing: InsiderBuy = {
      ticker: ticker.toUpperCase(),
      insiderName: src.display_names?.[0] ?? "",
      filedDate,
      daysAgo,
      totalValue: 0,
      formUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=4`,
    };

    edgarCache.set(cacheKey, { data: [filing], ts: Date.now() });
    return filing;
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────
function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : null;
}

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}
