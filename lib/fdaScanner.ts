// ─────────────────────────────────────────────────────────────
//  lib/fdaScanner.ts
//  FDA calendar + catalyst keyword scanner
//  Sources: FDA RSS, Yahoo Finance RSS, SEC 8-K EFTS
//  No API key needed. All public data.
//  Drop this file into your /lib folder.
// ─────────────────────────────────────────────────────────────

export interface CatalystSignal {
  ticker: string;
  type: "fda" | "merger" | "earnings" | "squeeze" | "contract" | "news";
  description: string;
  keywords: string[];
  daysOut?: number;       // for future events
  daysAgo?: number;       // for past events
  urgency: "High" | "Medium" | "Watch";
}

// Cache per ticker
const catalystCache = new Map<string, { data: CatalystSignal[]; ts: number }>();
const CACHE_TTL = 8 * 60 * 1000; // 8 minutes

// ── Keyword categories ───────────────────────────────────────
const FDA_KEYWORDS = [
  "pdufa", "fda approval", "fda approved", "fda grants", "nda approved",
  "bla approved", "advisory committee", "adcom", "complete response letter",
  "crl", "dispute resolution", "fdrr", "formal dispute", "appeal",
  "breakthrough therapy", "fast track", "orphan drug", "priority review",
  "phase 3 results", "phase 2 results", "clinical trial results",
  "clearance granted", "510k", "de novo",
];

const CATALYST_KEYWORDS: Record<string, string[]> = {
  merger: ["merger", "acquisition", "buyout", "tender offer", "going private", "strategic alternatives", "strategic review"],
  earnings: ["earnings beat", "revenue beat", "raised guidance", "guidance raise", "eps beat", "profit beat"],
  squeeze: ["short squeeze", "gamma squeeze", "short interest", "days to cover"],
  contract: ["government contract", "dod contract", "contract awarded", "contract win", "partnership agreement", "licensing agreement"],
};

// ── FDA RSS sources (public, no key needed) ──────────────────
const FDA_RSS = [
  "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
  "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drug-approvals/rss.xml",
];

// ── Main: scan a single ticker for catalyst signals ──────────
export async function getCatalystSignals(ticker: string): Promise<CatalystSignal[]> {
  const cached = catalystCache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const [fdaSignals, yahooSignals, sec8kSignals] = await Promise.all([
    scanFDARSS(ticker),
    scanYahooRSS(ticker),
    scanSEC8K(ticker),
  ]);

  const all = [...fdaSignals, ...yahooSignals, ...sec8kSignals];
  // Dedupe by type
  const seen = new Set<string>();
  const deduped = all.filter((s) => {
    const key = `${s.type}-${s.keywords[0]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  catalystCache.set(ticker, { data: deduped, ts: Date.now() });
  return deduped;
}

// ── Batch: scan multiple tickers efficiently ─────────────────
export async function getCatalystSignalsForTickers(
  tickers: string[]
): Promise<Map<string, CatalystSignal[]>> {
  const result = new Map<string, CatalystSignal[]>();
  // Run in parallel, max 5 at a time to avoid rate limits
  const chunks = chunk(tickers, 5);
  for (const ch of chunks) {
    const results = await Promise.all(ch.map(async (t) => ({ t, signals: await getCatalystSignals(t) })));
    for (const { t, signals } of results) {
      if (signals.length > 0) result.set(t, signals);
    }
  }
  return result;
}

// ── Highest urgency signal for a ticker ──────────────────────
export function topCatalystSignal(signals: CatalystSignal[]): CatalystSignal | null {
  if (!signals.length) return null;
  const order = { High: 0, Medium: 1, Watch: 2 };
  return [...signals].sort((a, b) => order[a.urgency] - order[b.urgency])[0];
}

// ── FDA RSS scanner ──────────────────────────────────────────
async function scanFDARSS(ticker: string): Promise<CatalystSignal[]> {
  const signals: CatalystSignal[] = [];

  for (const url of FDA_RSS) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "HTLabs signal-engine@htlabs.com" },
        next: { revalidate: 900 },
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const items = parseRSSItems(xml);

      for (const item of items) {
        const text = `${item.title} ${item.description}`.toLowerCase();
        if (!text.includes(ticker.toLowerCase())) continue;

        const matchedKWs = FDA_KEYWORDS.filter((kw) => text.includes(kw));
        if (!matchedKWs.length) continue;

        signals.push({
          ticker,
          type: "fda",
          description: item.title,
          keywords: matchedKWs,
          daysAgo: item.pubDate ? daysSince(item.pubDate) : undefined,
          urgency: matchedKWs.some((k) =>
            ["pdufa", "fda approved", "fda grants", "dispute resolution", "appeal"].includes(k)
          ) ? "High" : "Medium",
        });
      }
    } catch {
      continue;
    }
  }

  return signals;
}

// ── Yahoo Finance RSS scanner ────────────────────────────────
async function scanYahooRSS(ticker: string): Promise<CatalystSignal[]> {
  const signals: CatalystSignal[] = [];

  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];

    const xml = await res.text();
    const items = parseRSSItems(xml);

    for (const item of items) {
      const text = `${item.title} ${item.description}`.toLowerCase();

      // Check FDA keywords first (higher priority)
      const fdaMatches = FDA_KEYWORDS.filter((kw) => text.includes(kw));
      if (fdaMatches.length) {
        signals.push({
          ticker,
          type: "fda",
          description: item.title,
          keywords: fdaMatches,
          daysAgo: item.pubDate ? daysSince(item.pubDate) : undefined,
          urgency: "High",
        });
        continue;
      }

      // Check other catalyst categories
      for (const [catType, kws] of Object.entries(CATALYST_KEYWORDS)) {
        const matched = kws.filter((kw) => text.includes(kw));
        if (matched.length) {
          signals.push({
            ticker,
            type: catType as CatalystSignal["type"],
            description: item.title,
            keywords: matched,
            daysAgo: item.pubDate ? daysSince(item.pubDate) : undefined,
            urgency: catType === "merger" ? "High" : "Medium",
          });
          break;
        }
      }
    }
  } catch {
    // silent fail — Yahoo RSS is best-effort
  }

  return signals;
}

// ── SEC 8-K EFTS scanner ─────────────────────────────────────
async function scanSEC8K(ticker: string): Promise<CatalystSignal[]> {
  const signals: CatalystSignal[] = [];

  try {
    const today = isoDate(0);
    const past7 = isoDate(7);
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=8-K&dateRange=custom&startdt=${past7}&enddt=${today}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "HTLabs signal-engine@htlabs.com" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const hits = data?.hits?.hits ?? [];

    for (const hit of hits.slice(0, 3)) {
      const src = hit._source ?? {};
      const text = JSON.stringify(src).toLowerCase();
      const fileDate = src.file_date ?? "";

      const fdaMatches = FDA_KEYWORDS.filter((kw) => text.includes(kw));
      if (fdaMatches.length) {
        signals.push({
          ticker,
          type: "fda",
          description: `SEC 8-K filing: ${src.entity_name ?? ticker}`,
          keywords: fdaMatches,
          daysAgo: fileDate ? daysSince(fileDate) : undefined,
          urgency: "High",
        });
        continue;
      }

      for (const [catType, kws] of Object.entries(CATALYST_KEYWORDS)) {
        const matched = kws.filter((kw) => text.includes(kw));
        if (matched.length) {
          signals.push({
            ticker,
            type: catType as CatalystSignal["type"],
            description: `SEC 8-K filing: ${src.entity_name ?? ticker}`,
            keywords: matched,
            daysAgo: fileDate ? daysSince(fileDate) : undefined,
            urgency: "Medium",
          });
          break;
        }
      }
    }
  } catch {
    // silent
  }

  return signals;
}

// ── Helpers ──────────────────────────────────────────────────
interface RSSItem { title: string; description: string; pubDate: string }

function parseRSSItems(xml: string): RSSItem[] {
  return xml.split("<item>").slice(1).map((raw) => ({
    title: extractCDATA(raw, "title"),
    description: extractCDATA(raw, "description"),
    pubDate: extractTag(raw, "pubDate"),
  }));
}

function extractCDATA(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`));
  if (m) return m[1].trim();
  return extractTag(xml, tag);
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : "";
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 99;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000));
}

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}
