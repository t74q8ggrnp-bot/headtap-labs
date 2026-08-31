"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ValidationRow = {
  ticker: string;
  role: string;
  rank: number;
  score: number;
  scoreChange1m: number | null;
  scoreChange5m: number | null;
  price: number;
  relativeVolume: number | null;
  marketSession: string | null;
  dataAgeMs: number | null;
  spreadPercent: number | null;
  bid: number | null;
  ask: number | null;
  signalAt: string | null;
  signalPrice: number | null;
  currentReturnPercent: number | null;
  maxReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  proxState: string | null;
};

type ValidationPayload = {
  ok: boolean;
  status?: string;
  error?: string;
  tradingDate?: string;
  frameAt?: string;
  coverage?: { expected: number; persisted: number; complete: boolean };
  marketClock?: { session: string; active: boolean };
  rows?: ValidationRow[];
};

type HealthPayload = {
  ok?: boolean;
  status?: string;
  summary?: { failures?: string[] };
};

const number = (value: number | null, suffix = "") =>
  value === null ? "—" : `${value.toFixed(2)}${suffix}`;
const money = (value: number | null) =>
  value === null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
const clock = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value))
  : "—";
const age = (value: number | null) => {
  if (value === null) return "—";
  if (value < 1_000) return `${Math.max(0, Math.round(value))}ms`;
  if (value < 60_000) return `${Math.max(0, value / 1_000).toFixed(1)}s`;
  return `${Math.max(0, value / 60_000).toFixed(1)}m`;
};

function Delta({ value }: { value: number | null }) {
  const tone = value === null
    ? "text-zinc-600"
    : value > 0
      ? "text-emerald-400"
      : value < 0
        ? "text-rose-400"
        : "text-zinc-400";
  return <span className={`font-mono font-bold ${tone}`}>{number(value)}</span>;
}

export default function MarketValidationCockpit() {
  const [payload, setPayload] = useState<ValidationPayload | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [message, setMessage] = useState("Loading verified backend observations…");

  const refresh = useCallback(async () => {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setMessage("Sign in to view the internal validation cockpit.");
        return;
      }
      const [validationResponse, healthResponse] = await Promise.all([
        fetch("/api/market-validation", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/system-health", { cache: "no-store" }),
      ]);
      const validation = (await validationResponse.json()) as ValidationPayload;
      const nextHealth = (await healthResponse.json()) as HealthPayload;
      if (!validationResponse.ok || !validation.ok) {
        throw new Error(validation.error ?? "Validation data unavailable.");
      }
      setPayload(validation);
      setHealth(nextHealth);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Validation data unavailable.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const healthy = health?.ok === true && payload?.coverage?.complete === true;
  const failures = health?.summary?.failures ?? [];
  const rows = payload?.rows ?? [];

  return (
    <main className="min-h-screen bg-[#040505] px-4 py-5 text-white sm:px-7 lg:px-10">
      <div className="mx-auto max-w-[1680px] overflow-hidden rounded-[26px] border border-white/10 bg-[#080a0a] shadow-2xl shadow-black/50">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/8 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-5">
            <Link href="/" aria-label="Back to HT Labs">
              <Image src="/logo.png" alt="HT Labs" width={82} height={42} className="h-auto w-[72px]" priority />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-400">Internal telemetry</p>
              <h1 className="mt-1 text-xl font-black sm:text-2xl">Market Validation Cockpit</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold">
            <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-400 shadow-[0_0_14px_#34d399]" : "bg-amber-400"}`} />
            {healthy ? "Pipeline healthy" : "Validation required"}
          </div>
        </header>

        <section className="grid border-b border-white/8 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Market session", payload?.marketClock?.session?.replace("_", " ") ?? "—"],
            ["Decision frame", clock(payload?.frameAt)],
            ["Trading date", payload?.tradingDate ?? "—"],
            ["Coverage", payload?.coverage ? `${payload.coverage.persisted}/${payload.coverage.expected}` : "—"],
            ["Health failures", String(failures.length)],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-white/8 px-5 py-4 sm:border-r xl:border-b-0">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600">{label}</p>
              <p className="mt-2 truncate text-sm font-black capitalize text-zinc-200">{value}</p>
            </div>
          ))}
        </section>

        <section className="p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400">Priority Flow observation</p>
              <p className="mt-1 text-sm font-semibold text-zinc-500">Backend rank history, market age, microstructure, and outcomes. No browser re-ranking.</p>
            </div>
            <button onClick={() => void refresh()} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-white/[0.07]">Refresh now</button>
          </div>

          {message ? (
            <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.04] px-5 py-12 text-center text-sm font-semibold text-amber-200">{message}</div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-black/20 px-5 py-12 text-center text-sm font-semibold text-zinc-500">The backend has not persisted an active validation frame yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/8">
              <table className="min-w-[1220px] w-full border-collapse text-left">
                <thead className="bg-white/[0.025] text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600">
                  <tr>{["Rank","Ticker","Score","Δ 1m","Δ 5m","Price","RVOL","Spread","Data age","Signal","Return","Max / drawdown","ProX"].map((label) => <th key={label} className="border-b border-white/8 px-4 py-3">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ticker} className="border-b border-white/[0.055] last:border-0 hover:bg-white/[0.018]">
                      <td className="px-4 py-4 font-mono text-xs text-zinc-500">#{row.rank}</td>
                      <td className="px-4 py-4"><strong className="text-base">{row.ticker}</strong><p className="mt-1 text-[9px] uppercase tracking-wider text-zinc-600">{row.role}</p></td>
                      <td className="px-4 py-4 font-mono text-lg font-black text-violet-300">{row.score}</td>
                      <td className="px-4 py-4"><Delta value={row.scoreChange1m} /></td>
                      <td className="px-4 py-4"><Delta value={row.scoreChange5m} /></td>
                      <td className="px-4 py-4 font-mono text-sm font-bold">{money(row.price)}</td>
                      <td className="px-4 py-4 font-mono text-sm text-cyan-300">{number(row.relativeVolume, "x")}</td>
                      <td className="px-4 py-4 font-mono text-sm">{number(row.spreadPercent, "%")}</td>
                      <td className="px-4 py-4 font-mono text-xs text-zinc-400">{age(row.dataAgeMs)}</td>
                      <td className="px-4 py-4"><p className="font-mono text-xs">{money(row.signalPrice)}</p><p className="mt-1 text-[9px] text-zinc-600">{clock(row.signalAt)}</p></td>
                      <td className={`px-4 py-4 font-mono text-sm font-black ${(row.currentReturnPercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{number(row.currentReturnPercent, "%")}</td>
                      <td className="px-4 py-4 font-mono text-xs"><span className="text-emerald-400">{number(row.maxReturnPercent, "%")}</span><span className="mx-2 text-zinc-700">/</span><span className="text-rose-400">{number(row.maxDrawdownPercent, "%")}</span></td>
                      <td className="px-4 py-4 text-xs font-bold uppercase text-zinc-400">{row.proxState ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
