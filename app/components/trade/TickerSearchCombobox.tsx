"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceInstrument } from "@/lib/instrument-search";
import { writeWorkspaceInstrumentSeed } from "@/lib/workspace-instrument-seed";

type SearchPayload = {
  ok?: boolean;
  results?: WorkspaceInstrument[];
  error?: string;
};

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

function directSymbol(value: string) {
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export default function TickerSearchCombobox({
  currentSymbol,
  compact = false,
}: {
  currentSymbol: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceInstrument[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resultsQuery, setResultsQuery] = useState("");
  const directCandidate = directSymbol(query);
  const directOptionVisible = Boolean(
    open && query.trim() && !error && !loading &&
    results.length === 0 && directCandidate,
  );

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/instruments/search?q=${encodeURIComponent(trimmed)}&limit=8`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as SearchPayload;
        if (controller.signal.aborted) return;
        if (!response.ok || payload.ok !== true) {
          throw new Error("Ticker search is temporarily unavailable. Enter a supported symbol directly or try again.");
        }
        setResults(payload.results ?? []);
        setResultsQuery(trimmed);
        setActiveIndex(
          (payload.results?.length ?? 0) > 0 || directSymbol(trimmed) ? 0 : -1,
        );
        setOpen(true);
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setResults([]);
        setResultsQuery("");
        setActiveIndex(-1);
        setError(reason instanceof Error ? reason.message : "Search is temporarily unavailable.");
        setOpen(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const selectSymbol = (symbol: string, instrument?: WorkspaceInstrument) => {
    const normalized = directSymbol(symbol);
    if (!normalized) return;
    if (instrument?.symbol === normalized) {
      writeWorkspaceInstrumentSeed(window.sessionStorage, instrument);
    }
    setOpen(false);
    setQuery("");
    setResults([]);
    setResultsQuery("");
    setLoading(false);
    setError(null);
    setActiveIndex(-1);
    inputRef.current?.blur();
    router.push(`/trade/${encodeURIComponent(normalized)}`);
  };

  const submit = () => {
    const selected = resultsQuery === query.trim() && activeIndex >= 0
      ? results[activeIndex]
      : null;
    selectSymbol(selected?.symbol || directSymbol(query) || "", selected ?? undefined);
  };

  return (
    <div className="relative min-w-0 flex-1" data-testid="workspace-ticker-search">
      <div className={`ht-workspace-search flex min-h-11 items-center gap-2 ${compact ? "px-3 py-1.5" : "px-3.5 py-2.5"}`}>
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-zinc-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search stocks and ETFs"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeIndex >= 0
            ? results.length > 0 && activeIndex < results.length
              ? `${listboxId}-${activeIndex}`
              : directOptionVisible
                ? `${listboxId}-direct`
                : undefined
            : undefined}
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            // Results belong to the exact query that produced them. Clearing
            // them synchronously prevents Enter during the debounce window
            // from navigating to a stale selection from the previous query.
            setResults([]);
            setResultsQuery("");
            setActiveIndex(directSymbol(value) ? 0 : -1);
            setError(null);
            if (value.trim().length < 1) {
              setLoading(false);
            }
            setOpen(Boolean(value.trim()));
          }}
          onFocus={() => setOpen(Boolean(query.trim()))}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => results.length > 0
                ? Math.min(results.length - 1, index + 1)
                : directSymbol(query) ? 0 : -1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => results.length > 0
                ? Math.max(0, index - 1)
                : directSymbol(query) ? 0 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={`Search stocks or ETFs · ${currentSymbol}`}
          className="min-w-0 flex-1 bg-transparent text-[12px] font-bold text-white outline-none placeholder:font-semibold placeholder:text-zinc-600"
        />
        {loading ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/15 border-t-orange-400" aria-label="Searching" />
        ) : query ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={submit}
            className="ht-control min-h-9 px-2 py-1 text-[9px] uppercase tracking-[0.12em]"
            data-variant="quiet"
            data-size="small"
          >
            Open
          </button>
        ) : (
          <kbd className="hidden rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[8px] text-zinc-600 sm:inline">/</kbd>
        )}
      </div>

      {open && query.trim() && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Ticker search results"
          aria-busy={loading}
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-white/[0.11] bg-[#0a0d0f]/[0.98] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.72)] backdrop-blur-2xl"
        >
          {error ? (
            <p role="option" aria-selected="false" aria-disabled="true" className="px-3 py-3 text-[11px] font-semibold text-zinc-500">{error}</p>
          ) : loading && results.length === 0 ? (
            <p role="option" aria-selected="false" aria-disabled="true" className="px-3 py-3 text-[11px] font-semibold text-zinc-500">Searching verified instruments…</p>
          ) : results.length === 0 && directCandidate ? (
            <div
              id={`${listboxId}-direct`}
              role="option"
              aria-selected={activeIndex === 0}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => submit()}
              className={`flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl px-3 py-3 text-left transition ${activeIndex === 0 ? "bg-white/[0.07]" : "hover:bg-white/[0.05]"}`}
            >
              <span>
                <span className="block text-xs font-black text-zinc-200">Open {directCandidate}</span>
                <span className="mt-1 block text-[9px] font-semibold text-zinc-600">Verify directly with Massive</span>
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.12em] text-orange-400">Go</span>
            </div>
          ) : results.length === 0 ? (
            <p role="option" aria-selected="false" aria-disabled="true" className="px-3 py-3 text-[11px] font-semibold text-zinc-500">No supported stock or ETF matches this search.</p>
          ) : (
            results.map((instrument, index) => (
              <div
                id={`${listboxId}-${index}`}
                key={instrument.symbol}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSymbol(instrument.symbol, instrument)}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${index === activeIndex ? "bg-white/[0.07]" : "hover:bg-white/[0.045]"}`}
              >
                <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-black/50 font-mono text-[11px] font-black text-white">
                  {instrument.symbol.slice(0, 5)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-black text-zinc-200">{instrument.name}</span>
                  <span className="mt-0.5 block truncate text-[8px] font-bold uppercase tracking-[0.11em] text-zinc-600">
                    {instrument.assetKind === "etf" ? "ETF" : "Stock"}
                    {instrument.primaryExchange ? ` · ${instrument.primaryExchange}` : ""}
                  </span>
                </span>
                <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
