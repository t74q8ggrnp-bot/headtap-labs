"use client";

// app/prox/page.tsx
//
// Read-only Pro X status view. Shows what the SEC connector has actually
// collected — real events, real tickers, real evidence links. Discovery
// side only; nothing here feeds or reflects canonical HT Labs scoring.

import { useEffect, useState } from "react";
import { matureReadOnlyFailure } from "@/lib/checkpoint-a-ui-state";
import { PanelHeader, StatusState } from "@/app/components/ui/ApplicationPrimitives";

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
          setError(matureReadOnlyFailure("prox", res.status));
          setEvents([]);
        } else {
          setError(null);
          setEvents(data.events ?? []);
          setTotalCount(data.totalCount ?? 0);
        }
      } catch {
        if (!cancelled) setError(matureReadOnlyFailure("prox"));
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
    <main className="ht-discovery-route ht-prox-route min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <PanelHeader
          headingLevel={1}
          eyebrow="Pro X · discovery only"
          title="SEC filing feed"
          description="Verified connector evidence for independent research. This feed does not alter canonical HT scoring, publish a second public score, or carry execution authority."
          actions={(
            <span className="ht-inline-status" data-tone={error ? "warning" : "positive"} role="status" aria-live="polite">
              <span aria-hidden="true" />
              {loading ? "Checking" : error ? "Unavailable" : "Live"}
            </span>
          )}
          className="mb-7"
        />

        <dl className="ht-route-metrics mb-6 grid grid-cols-3" aria-label="Pro X filing summary">
          <div className="ht-route-metric">
            <dt>Total events</dt>
            <dd>{totalCount}</dd>
          </div>
          <div className="ht-route-metric">
            <dt>Showing</dt>
            <dd>{events.length}</dd>
          </div>
          <div className="ht-route-metric">
            <dt>Ticker-resolved</dt>
            <dd>{resolvedCount} / {events.length}</dd>
          </div>
        </dl>

        {error && (
          <div className="mb-6" role="alert">
            <StatusState tone="warning" title="Pro X feed unavailable" description={error} />
          </div>
        )}

        {loading ? (
          <StatusState busy title="Loading Pro X discovery" description="Checking the latest connector evidence." />
        ) : events.length === 0 && !error ? (
          <StatusState title="No events yet" description="The connector runs every 15 minutes." />
        ) : (
          <ol className="ht-event-list" aria-label="Pro X SEC filing events">
            {events.map((event) => {
              const primaryTicker = event.prox_event_tickers[0];
              return (
                <li key={event.id}>
                  <article className="ht-event-row">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="ht-document-type" aria-label={`Form ${event.form_type ?? "unknown"}`}>
                      {event.form_type ?? "—"}
                    </div>
                    <div className="min-w-0">
                      {event.raw_document_url ? (
                        <a href={event.raw_document_url} target="_blank" rel="noreferrer" className="ht-event-row__link">
                          {event.headline ?? "Untitled filing"}<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <p className="truncate text-sm font-bold text-white">{event.headline ?? "Untitled filing"}</p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                        <span>{CATEGORY_LABEL[event.catalyst_category] ?? event.catalyst_category}</span>
                        <span>{timeAgo(event.filed_at)}</span>
                        <span>· confidence {event.confidence ?? "—"}</span>
                        <span>· {event.verification_state.replaceAll("_", " ")}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {primaryTicker ? (
                      <span className="ht-symbol-label ht-symbol-label--positive">
                        {primaryTicker.ticker}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-zinc-500">
                        Unresolved
                      </span>
                    )}
                  </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
  );
}
