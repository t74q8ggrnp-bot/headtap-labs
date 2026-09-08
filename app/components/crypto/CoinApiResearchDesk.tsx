"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatMarketPrice } from "@/lib/market-price-format";
import type { readCoinApiPilot } from "@/lib/crypto/coinapi-pilot-server";
import CoinApiResearchChart from "./CoinApiResearchChart";

type ResearchRead = Awaited<ReturnType<typeof readCoinApiPilot>>;
type EvaluationRead = {
  schemaReady: boolean;
  coverage: { episodes: number; saved_books: number; observed_horizons: number; unavailable_horizons: number };
  legacyTracking?: { schemaReady: boolean; message: string };
};
const label = (value: string) => value.replaceAll("_", " ");
const price = (value: number | null | undefined) => value == null ? "—" : formatMarketPrice(value);
const timestamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Not available";

export default function CoinApiResearchDesk() {
  const [research, setResearch] = useState<ResearchRead | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationRead | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => setRefresh(value => value + 1));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const { data } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        const token = data.session?.access_token;
        setSignedIn(Boolean(token));
        if (!token) { setResearch(null); setEvaluation(null); setError(""); return; }
        const options = { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" as const, signal: controller.signal };
        const [researchResponse, evaluationResponse] = await Promise.all([
          fetch("/api/crypto/coinapi-research", options), fetch("/api/crypto/coinapi-evaluation", options),
        ]);
        if (!researchResponse.ok || !evaluationResponse.ok) {
          throw new Error([researchResponse.status, evaluationResponse.status].includes(401)
            ? "Your sign-in expired. Sign in again to read the shared feed."
            : `Connection check failed (prices ${researchResponse.status}, evidence ${evaluationResponse.status}). Stored data has not been verified.`);
        }
        const nextResearch = await researchResponse.json() as ResearchRead;
        const nextEvaluation = await evaluationResponse.json() as EvaluationRead;
        if (!controller.signal.aborted) { setResearch(nextResearch); setEvaluation(nextEvaluation); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResearch(null); setEvaluation(null);
          setError(cause instanceof Error ? cause.message : "Research connection unavailable.");
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  const markets = research?.publication?.markets ?? [];
  // Follow the backend's deep-selection order. This client never ranks a coin.
  const deepIds = research?.frame?.selectedMarkets ?? [];
  const selected = markets.find(row => row.marketId === selectedId) ?? markets.find(row => row.marketId === deepIds[0]) ?? null;
  const matching = markets.filter(row => `${row.base} ${row.exchange} ${row.marketId}`.toLowerCase().includes(search.toLowerCase()));

  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 text-zinc-200 sm:px-8">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
      <Link href="/" aria-label="HT Labs home"><Image src="/logo.png" width={98} height={56} alt="HT Labs" /></Link>
      <nav className="flex flex-wrap gap-5 text-sm"><Link href="/crypto">Crypto overview</Link><Link href="/paper/crypto" className="text-orange-300">Crypto paper trading →</Link><Link href="/paper">Stock paper</Link></nav>
    </header>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-cyan-300">CoinAPI · shared market data</p>
        <h1 className="mt-2 text-3xl font-bold">Crypto research desk</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">Inspect real prices, exchange liquidity and developing momentum. Research scores are experimental—not profit predictions.</p></div>
      <button type="button" onClick={() => { setLoading(true); setRefresh(value => value + 1); }} disabled={loading}
        className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{loading ? "Checking…" : "Refresh shared data"}</button>
    </div>
    {!loading && !signedIn && <p className="rounded-2xl border border-white/10 p-6">Sign in to HT Labs on the <Link href="/" className="text-cyan-300 underline">home page</Link>, then return here.</p>}
    {error && <p role="alert" className="mb-5 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm text-amber-100">{error}</p>}
    {research && <>
      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Collector", label(research.status)],
          ["Stored market pairs", String(markets.length)],
          ["Deeply analyzed this cycle", String(research.frame?.summary.scored ?? 0)],
          ["Reserved credits today (UTC) / cap", `${research.usage.reservedToday} / ${research.budget.daily_credit_limit}`],
        ].map(([name, value]) => <div key={name} className="rounded-2xl border border-white/10 bg-white/[.02] p-4"><p className="text-xs text-zinc-500">{name}</p><p className="mt-2 text-xl font-semibold capitalize">{value}</p></div>)}
      </section>
      {!research.publication && <section className="mb-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-6">
        <h2 className="font-semibold">Waiting for the first saved CoinAPI cycle</h2>
        <p className="mt-2 text-sm text-zinc-400">No sample prices or invented picks are displayed. This page reads storage; refreshing does not trigger paid provider calls.</p>
      </section>}
      {selected && <section className="mb-8 grid min-w-0 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline gap-3"><h2 className="text-3xl font-bold">{selected.base}/USD</h2><span className="text-2xl font-semibold text-cyan-200">{price(selected.price)}</span><span className="text-xs text-zinc-400">{selected.exchange}</span></div>
          <p className="mb-4 text-xs text-zinc-400">Provider price time: {timestamp(selected.priceAsOf)} · freshness is checked on each shared read</p>
          {selected.chart ? <CoinApiResearchChart marketId={selected.marketId} bars={selected.chart.bars} />
            : <p className="rounded-2xl border border-white/10 p-8 text-sm text-zinc-400">No verified candle history in this publication. Quote-only markets are not deep-scored.</p>}
        </div>
        <div className="rounded-2xl border border-white/10 p-5">
          <h3 className="text-lg font-semibold">What the evidence shows</h3>
          <p className="mt-2 capitalize text-cyan-200">{selected.research ? `${selected.research.state} · research score ${selected.research.score ?? "unavailable"}` : "Not deeply analyzed this cycle"}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-zinc-500">Bid</dt><dd>{price(selected.book?.bid)}</dd></div><div><dt className="text-zinc-500">Ask</dt><dd>{price(selected.book?.ask)}</dd></div>
            <div className="col-span-2"><dt className="text-zinc-500">Book timestamp</dt><dd>{timestamp(selected.book?.asOf)}</dd></div>
            <div><dt className="text-zinc-500">5m movement</dt><dd>{selected.research?.features?.return5m == null ? "—" : `${selected.research.features.return5m.toFixed(2)}%`}</dd></div>
            <div><dt className="text-zinc-500">Volume acceleration</dt><dd>{selected.research?.features?.volumeAcceleration5m == null ? "—" : `${selected.research.features.volumeAcceleration5m.toFixed(2)}×`}</dd></div>
          </dl>
          <p className="mt-5 text-xs text-zinc-400">Analysis time: {timestamp(selected.researchCollectedAt)}</p>
          <ul className="mt-3 space-y-2 text-xs text-zinc-400">{(selected.research?.observations ?? []).slice(0,4).map(text => <li key={text}>{text}</li>)}</ul>
          <details className="mt-4 text-xs text-zinc-500"><summary className="cursor-pointer">Coverage and missing evidence</summary><p className="mt-2 capitalize">{label(selected.coverage)}</p><p className="mt-2">{[...new Set([...selected.failures, ...(selected.research?.failures ?? [])])].map(label).join(" · ") || "No collection-time failures recorded."}</p></details>
        </div>
      </section>}
      {markets.length > 0 && <section className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Explore stored markets</h2>
          <input aria-label="Find coin or exchange" placeholder="Find coin or exchange" value={search} onChange={event => setSearch(event.target.value)} className="max-w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm" /></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{matching.slice(0,60).map(row => <button key={row.marketId} type="button" onClick={() => setSelectedId(row.marketId)}
          className={`rounded-xl border p-4 text-left ${row.marketId === selected?.marketId ? "border-cyan-300/40 bg-cyan-300/5" : "border-white/10 bg-white/[.02]"}`}>
          <span className="flex justify-between gap-3"><strong>{row.base}/USD</strong><span>{price(row.price)}</span></span>
          <span className="mt-2 block text-xs text-zinc-500">{row.exchange} · {row.research ? "Deep research available" : "Quote coverage"}</span></button>)}</div>
        <p className="mt-3 text-xs text-zinc-500">Showing {Math.min(matching.length,60)} of {matching.length} matching markets. Listed in stored publication order, not a buy ranking.</p>
      </section>}
      <details className="rounded-2xl border border-white/10 p-5 text-sm"><summary className="cursor-pointer font-semibold">Connection, usage and outcome tracking</summary>
        <div className="mt-4 space-y-3 text-zinc-400">
          <p>Authenticated price and evaluation reads: connected. Environment switch {research.configuration.environmentEnabled ? "on" : "off"}; database switch {research.configuration.databaseEnabled ? "on" : "off"}; provider credential {research.configuration.credentialConfigured ? "configured" : "missing"}.</p>
          <p>{research.usage.budgetMode === "recurring_daily_utc"
            ? `Daily UTC allowance: ${research.usage.reservedToday} / ${research.budget.daily_credit_limit} requests. Cumulative accounted requests: ${research.budget.lifetime_reserved}. Unused daily requests do not roll over.`
            : `Lifetime allowance: ${research.budget.lifetime_reserved} / ${research.budget.lifetime_credit_limit} requests.`} Credits are request allowances, not dollars. Collection stops before the active daily cap; this does not promise uninterrupted 24/7 coverage.</p>
          <p>Episodes {evaluation?.coverage.episodes ?? 0} · observed horizons {evaluation?.coverage.observed_horizons ?? 0} · unavailable horizons {evaluation?.coverage.unavailable_horizons ?? 0}. Gross quote returns are not executed profits.</p>
          <p>{evaluation?.legacyTracking?.message}</p>
          <p>Manual spot orders are available in the separate <Link href="/paper/crypto" className="text-orange-300 underline">crypto paper account</Link> once migration 0040 is installed and the shared feed is current. Agent execution remains off. This desk does not replace the main crypto ranking or change stock logic. No real brokerage route exists here.</p>
        </div>
      </details>
    </>}
  </main>;
}
