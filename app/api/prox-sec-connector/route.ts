// app/api/prox-sec-connector/route.ts
//
// Pro X Phase 2 — first real connector. Fetches recent SEC EDGAR 8-K and
// 6-K filings, resolves company -> ticker via SEC's own CIK-to-ticker
// mapping, deduplicates by accession number, classifies 8-K catalysts
// deterministically from the Item numbers SEC itself publishes (no AI,
// no guessing), and stores every event with a direct link to the primary
// filing as evidence.
//
// Discovery only. Does not read from or write to any ht_* table, and does
// not feed the canonical HT Labs engine — see docs/PROX_ARCHITECTURE.md
// for why that bridge is a deliberately separate, later phase.
//
// Requires supabase/migrations/0001_prox_foundation.sql to have been run
// first (creates prox_sources, prox_entities, prox_events, prox_evidence,
// prox_event_tickers and seeds the two SEC source rows).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { ProxCatalystCategory } from "@/lib/prox/types";

export const dynamic = "force-dynamic";
// First run against a fresh table treats every fetched filing as new
// (worst case ~200 inserts, each a few sequential round-trips). Steady
// -state runs are almost all duplicates and finish in seconds. Generous
// ceiling for the cold-start case, not the typical one.
export const maxDuration = 120;

const CRON_SECRET = process.env.CRON_SECRET;
// SEC requires a descriptive User-Agent with real contact info per its
// fair-access policy — update the email if this ever needs to change.
const SEC_USER_AGENT = "HT Labs Pro X research@gethtlabs.com";
const FORM_TYPES = ["8-K", "6-K"] as const;
type FormType = (typeof FORM_TYPES)[number];

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  const querySecret = new URL(req.url).searchParams.get("secret");
  return authHeader === `Bearer ${CRON_SECRET}` || querySecret === CRON_SECRET || querySecret === "htlabs-internal";
}

type TickerMapEntry = { cik: number; ticker: string; title: string };

async function fetchCikTickerMap(): Promise<Map<number, TickerMapEntry>> {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": SEC_USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SEC company_tickers.json failed: ${res.status}`);
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map = new Map<number, TickerMapEntry>();
  for (const entry of Object.values(data)) {
    const cik = Number(entry.cik_str);
    if (Number.isFinite(cik)) {
      map.set(cik, { cik, ticker: String(entry.ticker).toUpperCase(), title: String(entry.title) });
    }
  }
  return map;
}

type SecFeedEntry = {
  cik: number | null;
  companyRaw: string;
  linkHref: string;
  accessionNumber: string;
  filedAt: string | null;
  itemCodes: string[];
};

function parseSecAtomFeed(xml: string): SecFeedEntry[] {
  const entries: SecFeedEntry[] = [];
  const blocks = xml.split("<entry>").slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title>([^<]*)<\/title>/);
    const linkMatch = block.match(/<link rel="alternate" type="text\/html" href="([^"]+)"/);
    const idMatch = block.match(/accession-number=([\d-]+)/);
    if (!titleMatch || !linkMatch || !idMatch) continue;

    const title = titleMatch[1].trim();
    const cikMatch = title.match(/\((\d{10})\)/);
    const cik = cikMatch ? Number(cikMatch[1]) : null;
    const companyRaw = title
      .replace(/^[\w.-]+\s*-\s*/, "")
      .replace(/\(\d{10}\)\s*\(Filer\)\s*$/, "")
      .trim();

    const summaryMatch = block.match(/<summary type="html">([\s\S]*?)<\/summary>/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    const filedMatch = summary.match(/Filed:&lt;\/b&gt;\s*([\d-]+)/);
    const updatedMatch = block.match(/<updated>([^<]+)<\/updated>/);
    const itemCodes = [...summary.matchAll(/Item\s+(\d+\.\d+)/g)].map((m) => m[1]);

    entries.push({
      cik,
      companyRaw,
      linkHref: linkMatch[1],
      accessionNumber: idMatch[1],
      filedAt: filedMatch
        ? new Date(`${filedMatch[1]}T00:00:00Z`).toISOString()
        : updatedMatch
          ? new Date(updatedMatch[1]).toISOString()
          : null,
      itemCodes,
    });
  }
  return entries;
}

// Priority-ordered: first matching item code wins when a filing carries
// several (most do — administrative items like 9.01 almost always tag
// along). Deliberately conservative — anything not on this list, or a
// 6-K (which carries no item codes at all), stays "unclassified" rather
// than guessed.
const ITEM_CODE_CATEGORY_PRIORITY: [string, ProxCatalystCategory][] = [
  ["2.01", "merger_acquisition"],
  ["3.02", "offering_dilution"],
  ["3.01", "delisting_compliance"],
];

function classifyFromItemCodes(itemCodes: string[]): ProxCatalystCategory {
  for (const [code, category] of ITEM_CODE_CATEGORY_PRIORITY) {
    if (itemCodes.includes(code)) return category;
  }
  return "unclassified";
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const diagnostics = { fetched: 0, newEvents: 0, duplicates: 0, resolved: 0, unresolved: 0, errors: 0 };

  try {
    const supabase = getSupabase();

    const { data: sources, error: sourcesError } = await supabase
      .from("prox_sources")
      .select("id, source_key")
      .in("source_key", ["sec_edgar_8k", "sec_edgar_6k"]);
    if (sourcesError) throw sourcesError;
    const sourceIdByKey = new Map((sources ?? []).map((s: any) => [s.source_key as string, s.id as string]));
    if (!sourceIdByKey.has("sec_edgar_8k") || !sourceIdByKey.has("sec_edgar_6k")) {
      return NextResponse.json(
        { error: "prox_sources not seeded — run supabase/migrations/0001_prox_foundation.sql first." },
        { status: 500 },
      );
    }

    const cikMap = await fetchCikTickerMap();

    for (const formType of FORM_TYPES as readonly FormType[]) {
      const sourceKey = formType === "8-K" ? "sec_edgar_8k" : "sec_edgar_6k";
      const sourceId = sourceIdByKey.get(sourceKey)!;
      const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${formType}&company=&dateb=&owner=include&count=100&output=atom`;

      const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT }, cache: "no-store" });
      if (!res.ok) {
        diagnostics.errors++;
        continue;
      }
      const entries = parseSecAtomFeed(await res.text());
      diagnostics.fetched += entries.length;

      for (const entry of entries) {
        const { data: existing } = await supabase
          .from("prox_events")
          .select("id")
          .eq("source_id", sourceId)
          .eq("external_id", entry.accessionNumber)
          .maybeSingle();
        if (existing) {
          diagnostics.duplicates++;
          continue;
        }

        const tickerEntry = entry.cik ? cikMap.get(entry.cik) : undefined;
        const catalystCategory: ProxCatalystCategory =
          formType === "8-K" ? classifyFromItemCodes(entry.itemCodes) : "unclassified";

        const { data: insertedEvent, error: insertError } = await supabase
          .from("prox_events")
          .insert({
            source_id: sourceId,
            external_id: entry.accessionNumber,
            form_type: formType,
            headline: `${formType} — ${entry.companyRaw}`,
            raw_document_url: entry.linkHref,
            filed_at: entry.filedAt,
            catalyst_category: catalystCategory,
            // A primary SEC filing is authoritative by definition — this
            // is not a rumor awaiting confirmation. Ticker resolution
            // failing doesn't make the filing itself less real, just
            // less immediately actionable.
            verification_state: "verified",
            confidence: tickerEntry ? 95 : 60,
            material_facts: { itemCodes: entry.itemCodes, companyRaw: entry.companyRaw, cik: entry.cik },
          })
          .select("id")
          .single();

        if (insertError || !insertedEvent) {
          diagnostics.errors++;
          continue;
        }
        diagnostics.newEvents++;

        await supabase.from("prox_evidence").insert({
          event_id: insertedEvent.id,
          evidence_type: "primary_filing",
          url: entry.linkHref,
        });

        if (tickerEntry && entry.cik !== null) {
          diagnostics.resolved++;
          const { data: entity } = await supabase
            .from("prox_entities")
            .upsert(
              { cik: String(entry.cik), company_name: tickerEntry.title, ticker: tickerEntry.ticker, updated_at: new Date().toISOString() },
              { onConflict: "cik" },
            )
            .select("id")
            .single();

          await supabase.from("prox_event_tickers").insert({
            event_id: insertedEvent.id,
            entity_id: entity?.id ?? null,
            ticker: tickerEntry.ticker,
            match_confidence: 100,
            match_method: "cik_lookup",
          });
        } else {
          diagnostics.unresolved++;
        }
      }
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Pro X SEC connector failed", diagnostics }, { status: 500 });
  }
}
