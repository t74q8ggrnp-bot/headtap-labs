"use client";

// app/prox/page.tsx
//
// Read-only Pro X status view. Shows what the SEC connector has actually
// collected — real events, real tickers, real evidence links. Discovery
// side only; nothing here feeds or reflects canonical HT Labs scoring.

import { useEffect, useState } from "react";
import { getErrorMessage } from "@/lib/error-message";

type ProxEventTicker = {
  ticker: string;
  match_confidence: number;
  match_method: string;
};

type ProxEvent = {
  id: string;
  form_type: string | null;
  headline: string | null;
  raw_document_url: string | null;
  filed_at: string | null;
  catalyst_category: string;
  verification_state: string;
  confidence: number | null;
  material_facts: Record<string, unknown> | null;
  created_at: string;
  prox_event_tickers: ProxEventTicker[];
};

const CATEGORY_LABEL: Record<string, string> = {
  merger_acquisition: "Merger / Acquisition",
  offering_dilution: "Offering / Dilution",
  delisting_compliance: "Delisting / Compliance",
  insider_transaction: "Insider Transaction",
  unclassified: "Unclassified",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ProxPage() {
  const [events, setEvents] = useState<ProxEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/prox-events?limit=100", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? "Failed to load Pro X events");
          setEvents([]);
        } else {
          setError(null);
          setEvents(data.events ?? []);
          setTotalCount(data.totalCount ?? 0);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, "Failed to load Pro X events"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const resolvedCount = events.filter((e) => e.prox_event_tickers.length > 0).length;

  return (
    <div className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">Pro X</p>
            <h1 className="text-3xl font-black">Discovery Feed</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Real SEC filings collected by the connector. Discovery only — nothing here feeds HT Labs&apos; canonical scoring.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            <span className="text-xs font-black uppercase tracking-wider text-zinc-500">Live</span>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Total Events</p>
            <p className="mt-1 text-2xl font-black">{totalCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Showing</p>
            <p className="mt-1 text-2xl font-black">{events.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Ticker-Resolved</p>
            <p className="mt-1 text-2xl font-black">{resolvedCount} / {events.length}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-600">Loading...</p>
        ) : events.length === 0 && !error ? (
          <p className="text-sm text-zinc-600">No events yet. The connector runs every 15 minutes.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((event) => {
              const primaryTicker = event.prox_event_tickers[0];
              return (
                <a
                  key={event.id}
                  href={event.raw_document_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 transition hover:border-orange-500/30 hover:bg-zinc-950/90"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="w-16 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-[10px] font-black text-zinc-400">
                      {event.form_type ?? "—"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{event.headline ?? "Untitled filing"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                        <span className="rounded-full border border-white/10 px-2 py-0.5 font-black uppercase tracking-wide">
                          {CATEGORY_LABEL[event.catalyst_category] ?? event.catalyst_category}
                        </span>
                        <span>{timeAgo(event.filed_at)}</span>
                        <span>· confidence {event.confidence ?? "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {primaryTicker ? (
                      <span className="rounded-full border border-green-500/25 bg-green-500/10 px-3 py-1 text-sm font-black text-green-300">
                        {primaryTicker.ticker}
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-zinc-500">
                        Unresolved
                      </span>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
