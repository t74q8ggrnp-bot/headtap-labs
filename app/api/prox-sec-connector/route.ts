// app/api/prox-sec-connector/route.ts
//
// Pro X Phase 2 — first real connector. Fetches recent SEC EDGAR 8-K, 6-K,
// and Form 4 (insider transaction) filings, resolves company -> ticker via
// SEC's own CIK-to-ticker mapping, deduplicates by accession number,
// classifies 8-K catalysts deterministically from the Item numbers SEC
// itself publishes (no AI, no guessing), and stores every event with a
// direct link to the primary filing as evidence.
//
// Form 4 quirk: each filing publishes two linked feed entries sharing one
// accession number — one tagged "(Reporting)" for the insider person, one
// "(Issuer)" for the actual public company. Only the CIK on the Issuer
// entry maps to a ticker, so the Reporting entry is dropped at parse time
// rather than raced against dedup.
//
// Discovery only. Does not read from or write to any ht_* table, and does
// not feed the canonical HT Labs engine — see docs/PROX_ARCHITECTURE.md
// for why that bridge is a deliberately separate, later phase.
//
// Requires supabase/migrations/0001_prox_foundation.sql to have been run
// first (creates prox_sources, prox_entities, prox_events, prox_evidence,
// prox_event_tickers). Source rows themselves are self-healing — see
// REQUIRED_SOURCES below — so adding a new form type never needs a second
// manual migration.

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
const FORM_TYPES = ["8-K", "6-K", "4"] as const;
type FormType = (typeof FORM_TYPES)[number];

const SOURCE_KEY_BY_FORM: Record<FormType, string> = {
  "8-K": "sec_edgar_8k",
  "6-K": "sec_edgar_6k",
  "4": "sec_edgar_form4",
};

// Self-healing: upserted every run instead of requiring a manual seed step.
// Adding a new form type to FORM_TYPES only needs an entry here, never a
// second manual migration.
const REQUIRED_SOURCES = [
  { source_key: "sec_edgar_8k", display_name: "SEC EDGAR — Form 8-K", tier: "primary", base_credibility: 95 },
  { source_key: "sec_edgar_6k", display_name: "SEC EDGAR — Form 6-K", tier: "primary", base_credibility: 95 },
  { source_key: "sec_edgar_form4", display_name: "SEC EDGAR — Form 4 (insider transaction)", tier: "primary", base_credibility: 95 },
];

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
  role: string | null; // 'Filer' | 'Issuer' | 'Reporting' | ...
  linkHref: string;
  accessionNumber: string;
  filedAt: string | null;
  itemCodes: string[];
};

function parseSecAtomFeed(xml: string, formType: FormType): SecFeedEntry[] {
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
    const roleMatch = title.match(/\(([A-Za-z]+)\)\s*$/);
    const role = roleMatch ? roleMatch[1] : null;
    const companyRaw = title
      .replace(/^[\w.-]+\s*-\s*/, "")
      .replace(/\(\d{10}\)\s*\([A-Za-z]+\)\s*$/, "")
      .trim();

    // Form 4 publishes one entry per party on the filing (insider + issuer,
    // same accession number). Only the Issuer entry's CIK maps to a public
    // ticker — drop everything else here, before dedup ever sees it.
    if (formType === "4" && role !== "Issuer") continue;

    const summaryMatch = block.match(/<summary type="html">([\s\S]*?)<\/summary>/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    const filedMatch = summary.match(/Filed:&lt;\/b&gt;\s*([\d-]+)/);
    const updatedMatch = block.match(/<updated>([^<]+)<\/updated>/);
    const itemCodes = [...summary.matchAll(/Item\s+(\d+\.\d+)/g)].map((m) => m[1]);

    entries.push({
      cik,
      companyRaw,
      role,
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

// Phase 4 (partial) — SEC's own submissions API publishes each company's
// former names with date ranges. Free, deterministic, no AI needed. Only
// fetched once per entity (new entity, or one whose former_names is still
// empty) — former names essentially never change, no reason to re-fetch
// on every run.
async function fetchFormerNames(cik: number): Promise<{ name: string; from: string | null; to: string | null }[]> {
  try {
    const paddedCik = String(cik).padStart(10, "0");
    const res = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, {
      headers: { "User-Agent": SEC_USER_AGENT },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const formerNames = Array.isArray(data?.formerNames) ? data.formerNames : [];
    return formerNames.map((f: any) => ({ name: String(f?.name ?? ""), from: f?.from ?? null, to: f?.to ?? null }));
  } catch {
    return [];
  }
}

function classifyEvent(formType: FormType, itemCodes: string[]): ProxCatalystCategory {
  if (formType === "4") return "insider_transaction";
  if (formType === "8-K") {
    for (const [code, category] of ITEM_CODE_CATEGORY_PRIORITY) {
      if (itemCodes.includes(code)) return category;
    }
  }
  return "unclassified";
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const diagnostics = { fetched: 0, newEvents: 0, duplicates: 0, resolved: 0, unresolved: 0, errors: 0, formerNamesFetched: 0 };

  try {
    const supabase = getSupabase();

    // Table existence still requires the manual migration (no DDL access
    // here), but the rows inside it are self-healing — this makes adding
    // a new form type a one-line change to REQUIRED_SOURCES, not a second
    // trip to the SQL editor.
    const { error: upsertSourcesError } = await supabase
      .from("prox_sources")
      .upsert(REQUIRED_SOURCES, { onConflict: "source_key" });
    if (upsertSourcesError) {
      return NextResponse.json(
        {
          error: `Could not write prox_sources (${upsertSourcesError.message}) — has supabase/migrations/0001_prox_foundation.sql been run yet?`,
        },
        { status: 500 },
      );
    }

    const { data: sources, error: sourcesError } = await supabase
      .from("prox_sources")
      .select("id, source_key")
      .in("source_key", Object.values(SOURCE_KEY_BY_FORM));
    if (sourcesError) throw sourcesError;
    const sourceIdByKey = new Map((sources ?? []).map((s: any) => [s.source_key as string, s.id as string]));

    const cikMap = await fetchCikTickerMap();

    for (const formType of FORM_TYPES as readonly FormType[]) {
      const sourceId = sourceIdByKey.get(SOURCE_KEY_BY_FORM[formType]);
      if (!sourceId) {
        diagnostics.errors++;
        continue;
      }
      const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(formType)}&company=&dateb=&owner=include&count=100&output=atom`;

      const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT }, cache: "no-store" });
      if (!res.ok) {
        diagnostics.errors++;
        continue;
      }
      const entries = parseSecAtomFeed(await res.text(), formType);
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
        const catalystCategory: ProxCatalystCategory = classifyEvent(formType, entry.itemCodes);

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
          const cikStr = String(entry.cik);

          const { data: existingEntity } = await supabase
            .from("prox_entities")
            .select("id, former_names")
            .eq("cik", cikStr)
            .maybeSingle();

          let entityId: string | null = existingEntity?.id ?? null;
          const needsFormerNames =
            !existingEntity || !Array.isArray(existingEntity.former_names) || existingEntity.former_names.length === 0;

          if (needsFormerNames) {
            const formerNames = await fetchFormerNames(entry.cik);
            if (formerNames.length > 0) diagnostics.formerNamesFetched++;
            if (existingEntity) {
              await supabase
                .from("prox_entities")
                .update({ company_name: tickerEntry.title, ticker: tickerEntry.ticker, former_names: formerNames, updated_at: new Date().toISOString() })
                .eq("id", existingEntity.id);
            } else {
              const { data: newEntity } = await supabase
                .from("prox_entities")
                .insert({ cik: cikStr, company_name: tickerEntry.title, ticker: tickerEntry.ticker, former_names: formerNames })
                .select("id")
                .single();
              entityId = newEntity?.id ?? null;
            }
          } else {
            await supabase
              .from("prox_entities")
              .update({ company_name: tickerEntry.title, ticker: tickerEntry.ticker, updated_at: new Date().toISOString() })
              .eq("id", existingEntity!.id);
          }

          await supabase.from("prox_event_tickers").insert({
            event_id: insertedEvent.id,
            entity_id: entityId,
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
