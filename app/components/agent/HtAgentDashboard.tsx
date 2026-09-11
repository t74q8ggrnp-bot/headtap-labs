"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { HtAgentMode, HtTradePlan } from "@/lib/ht-agent/contracts";
import HtTradePlanCard from "./HtTradePlanCard";

type DecisionRow = {
  id: string;
  symbol: string;
  action: string;
  state: string;
  mode: string;
  proposed_entry: number | null;
  proposed_stop: number | null;
  proposed_target: number | null;
  proposed_quantity: number;
  maximum_risk: number;
  estimated_notional: number;
  risk_allowed: boolean;
  explanation: string;
  trade_plan: HtTradePlan | null;
  decided_at: string;
};

type AgentDashboard = {
  generatedAt: string;
  authority: { detection: string; research: string; risk: string; execution: string; liveBrokerage: false };
  control: { globalKillSwitch: boolean; globalReason: string; profileKillSwitch: boolean; mode: HtAgentMode; status: string };
  paper: {
    account: { equity: number; buyingPower: number; realizedPnl: number };
    positions: Array<{ symbol: string; side: string; quantity: number; currentPrice: number | null; unrealizedPnl: number | null }>;
  };
  riskUtilization: { grossExposure: number; grossExposurePercent: number; openPositions: number; maximumPositions: number };
  watchlist: DecisionRow[];
  proposals: DecisionRow[];
  decisions: DecisionRow[];
  runs: Array<{ id: string; status: string; decision_count: number; order_count: number; started_at: string }>;
  cohortMetrics: Array<{ cohort: string; observations: number; wouldEnter: number; measuredOutcomes: number; averageReturnPercent: number | null; positiveRatePercent: number | null }>;
  riskPolicy: Record<string, number | string>;
};

const money = (value: number | null | undefined) => value === null || value === undefined
  ? "—"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

const price = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) < 0.01 ? 6 : Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};

function publicActionLabel(action: string) {
  if (action === "reject") return "observed";
  if (action === "expire") return "expired";
  return action;
}

function hasEntryProposal(decision: DecisionRow) {
  return ["prepare", "enter"].includes(decision.action)
    && decision.proposed_entry !== null
    && decision.proposed_entry > 0
    && decision.proposed_stop !== null
    && decision.proposed_stop > 0
    && decision.proposed_stop < decision.proposed_entry
    && decision.proposed_target !== null
    && decision.proposed_target > decision.proposed_entry;
}

function badgeTone(action: string) {
  if (["enter", "manage"].includes(action)) return "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
  if (["exit", "reduce"].includes(action)) return "border-red-400/25 bg-red-500/10 text-red-300";
  if (action === "prepare") return "border-orange-400/25 bg-orange-500/10 text-orange-300";
  return "border-violet-400/20 bg-violet-500/10 text-violet-300";
}

export default function HtAgentDashboard() {
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  const request = useCallback(async (init?: RequestInit) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("Sign in to use HT Agent.");
    const response = await fetch("/api/ht-agent", {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const body = await response.json() as { ok: boolean; dashboard?: AgentDashboard; error?: string };
    if (!response.ok || !body.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Your HT Agent session has expired. Sign in again to continue."
          : "HT Agent is temporarily unavailable. No paper action was taken.",
      );
    }
    if (body.dashboard) setDashboard(body.dashboard);
    return body;
  }, []);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await request({ method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HT Agent request failed.");
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthError("");
      setSignedIn(Boolean(data.session));
      setAuthReady(true);
      if (data.session) void request().catch((error) => setMessage(error.message));
    }).catch(() => {
      if (!mounted) return;
      setAuthError("Your secure session could not be verified. Reload the page to try again. No paper action was taken.");
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setAuthError("");
      setSignedIn(Boolean(session));
      setAuthReady(true);
      if (session) void request().catch((error) => setMessage(error.message));
      else setDashboard(null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [request]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(() => void request().catch(() => undefined), 20_000);
    return () => window.clearInterval(timer);
  }, [request, signedIn]);

  if (!authReady) return (
    <main
      className="grid min-h-screen place-items-center bg-[#050505] px-6 text-center text-white"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">HT Agent</p>
        <h1 className="mt-3 text-2xl font-black">Opening your secure workspace</h1>
        <p className="mt-2 text-sm text-zinc-500">Checking your paper-only session…</p>
      </div>
    </main>
  );

  return (
    <main className="ht-phase25-route ht-operator-route ht-agent-route min-h-screen bg-[#050505] px-3 py-4 text-white sm:px-6 lg:px-8" data-route-audience="operator">
      <div className="ht-phase25-frame mx-auto max-w-[1680px] overflow-hidden rounded-[28px] border border-white/10 bg-[#080b0d] shadow-2xl shadow-black/60">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/8 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="HT Labs home"><Image src="/logo.png" alt="HT Labs" width={2909} height={1959} className="h-10 w-auto" priority /></Link>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em]">
            <span className={`h-2 w-2 rounded-full ${dashboard && !dashboard.control.globalKillSwitch && !dashboard.control.profileKillSwitch ? "bg-emerald-400 shadow-[0_0_16px_#34d399]" : "bg-red-400"}`} />
            Paper only · no broker route
          </div>
        </header>

        {!signedIn ? (
          authError ? (
            <section className="grid min-h-[620px] place-items-center px-6 text-center" role="alert">
              <div><h1 className="text-2xl font-black">HT Agent session unavailable</h1><p className="mt-3 max-w-xl text-zinc-500">{authError}</p></div>
            </section>
          ) : <section className="grid min-h-[620px] place-items-center px-6 text-center">
            <div><h1 className="text-3xl font-black">Sign in to open HT Agent</h1><p className="mt-3 text-zinc-500">Your Agent is isolated to your HT Labs paper account.</p><Link href="/" className="mt-6 inline-block rounded-xl bg-orange-500 px-6 py-3 font-black text-black">Go to sign in</Link></div>
          </section>
        ) : !dashboard ? (
          <section className="grid min-h-[620px] place-items-center px-6 text-center"><div><p className="text-xl font-black">HT Agent is unavailable</p><p className="mt-3 max-w-xl text-sm text-zinc-500">{message || "Loading the paper-only control plane…"}</p></div></section>
        ) : (
          <>
            <section className="ht-operator-control-grid grid border-b border-white/8 lg:grid-cols-[1.35fr_.65fr]" aria-labelledby="agent-control-heading">
              <div className="px-5 py-7 lg:px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">HT Agent · Phase 1</p>
                <div className="mt-3 flex flex-wrap items-end gap-4"><h1 id="agent-control-heading" className="text-4xl font-black tracking-tight sm:text-6xl">Decision control</h1><span className="mb-2 rounded-full border border-orange-400/25 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-orange-300">{dashboard.control.mode.replaceAll("_", " ")}</span></div>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-500">Canonical detects and ranks. Independent ProX supports, warns, vetoes, or abstains. A deterministic risk gate owns every paper action.</p>
                <div className="mt-7 grid grid-cols-3 gap-3">
                  {[['Equity', money(dashboard.paper.account.equity)], ['Buying power', money(dashboard.paper.account.buyingPower)], ['Realized P&L', money(dashboard.paper.account.realizedPnl)]].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-2 truncate font-mono text-sm font-black sm:text-lg">{value}</p></div>)}
                </div>
              </div>
              <aside className="border-t border-white/8 bg-black/25 p-5 lg:border-l lg:border-t-0 lg:p-7">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Operating mode</p>
                <div className="mt-3 grid gap-2">
                  {(["observe", "approval_paper", "paper_autopilot"] as HtAgentMode[]).map((mode) => <button key={mode} disabled={busy} onClick={() => void act({ action: "configure", mode })} className={`rounded-xl border px-4 py-3 text-left text-xs font-black uppercase tracking-wider ${dashboard.control.mode === mode ? "border-orange-400/40 bg-orange-500/10 text-orange-300" : "border-white/8 text-zinc-500 hover:border-white/20"}`}>{mode.replaceAll("_", " ")}</button>)}
                </div>
                <button disabled={busy} onClick={() => void act({ action: "configure", killSwitch: !dashboard.control.profileKillSwitch })} className={`mt-4 w-full rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider ${dashboard.control.profileKillSwitch ? "border-red-400/30 bg-red-500/10 text-red-300" : "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"}`}>{dashboard.control.profileKillSwitch ? "Profile locked · unlock paper Agent" : "Profile active · engage kill switch"}</button>
                <button disabled={busy || dashboard.control.globalKillSwitch} onClick={() => void act({ action: "run" })} className="mt-3 w-full rounded-xl bg-orange-500 px-4 py-3 text-xs font-black uppercase tracking-wider text-black disabled:cursor-not-allowed disabled:opacity-30">{busy ? "Processing…" : "Run aligned decision cycle"}</button>
                {dashboard.control.globalKillSwitch && <p className="mt-3 text-xs text-red-300">Global kill switch: {dashboard.control.globalReason}</p>}
                {message && <p className="mt-3 text-xs text-red-300" role="alert">{message}</p>}
              </aside>
            </section>

            <section className="border-b border-white/8 px-5 py-5 lg:px-8">
              {dashboard.decisions.find((decision) => decision.trade_plan?.version === "ht-trade-plan-v1")?.trade_plan ? (
                <HtTradePlanCard
                  plan={dashboard.decisions.find((decision) => decision.trade_plan?.version === "ht-trade-plan-v1")!.trade_plan!}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-5 py-7 text-center">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300">HT Trade Plan</p>
                  <p className="mt-2 text-sm font-bold text-zinc-500">No backend-owned plan exists yet. Run an aligned Observe cycle; HT Agent will not invent one.</p>
                </div>
              )}
            </section>

            <section className="border-b border-white/8 px-5 py-5 lg:px-8">
              <div className="flex items-center justify-between gap-4"><h2 className="text-lg font-black">Paper positions</h2><div className="text-right text-[10px] text-zinc-500"><span>{dashboard.riskUtilization.openPositions}/{dashboard.riskUtilization.maximumPositions} slots</span><span className="ml-4">{dashboard.riskUtilization.grossExposurePercent.toFixed(1)}% utilized</span></div></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {dashboard.paper.positions.map((position) => <div key={position.symbol} className="flex items-center justify-between rounded-xl border border-white/8 bg-black/20 p-3"><div><strong>{position.symbol}</strong><p className="text-[10px] text-zinc-600">{position.side} · {position.quantity} shares</p></div><div className="text-right"><p className="font-mono text-sm">{price(position.currentPrice)}</p><p className={`font-mono text-[10px] ${(position.unrealizedPnl ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(position.unrealizedPnl)}</p></div></div>)}
                {dashboard.paper.positions.length === 0 && <p className="rounded-xl border border-white/8 bg-black/20 p-4 text-sm text-zinc-600 sm:col-span-2 xl:col-span-3">No open paper positions.</p>}
              </div>
            </section>

            <section className="p-5 lg:p-8">
              <div>
                <div className="flex items-center justify-between"><h2 className="text-lg font-black">Decision stream</h2><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">Includes no-trades</span></div>
                <div className="ht-operator-record-list mt-4 grid gap-3 lg:grid-cols-2" role="list">
                  {dashboard.decisions.slice(0, 16).map((decision) => <article key={decision.id} className="rounded-2xl border border-white/8 bg-black/20 p-4" role="listitem">
                    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><strong className="text-xl">{decision.symbol}</strong><span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${badgeTone(decision.action)}`}>{publicActionLabel(decision.action)}</span><span className="text-[9px] uppercase text-zinc-600">{decision.state}</span></div><time className="text-[10px] text-zinc-600">{new Date(decision.decided_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{decision.explanation}</p>
                    {hasEntryProposal(decision) ? (
                      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-zinc-400 sm:grid-cols-4"><span>Entry {price(decision.proposed_entry)}</span><span>Stop {price(decision.proposed_stop)}</span><span>Target {price(decision.proposed_target)}</span><span>Max risk {money(decision.maximum_risk)}</span></div>
                    ) : ["manage", "reduce", "exit"].includes(decision.action) ? (
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-zinc-400"><span>Reference {price(decision.proposed_entry)}</span><span>{decision.proposed_quantity} shares</span></div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-zinc-600"><span>Observed at {price(decision.proposed_entry)}</span><span>No paper order created</span></div>
                    )}
                    {decision.state === "pending_approval" && <div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => void act({ action: "approve", decisionId: decision.id })} className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black text-black">Approve paper</button><button disabled={busy} onClick={() => void act({ action: "decline", decisionId: decision.id })} className="rounded-lg border border-white/10 px-4 py-2 text-xs font-black text-zinc-400">Decline</button></div>}
                  </article>)}
                  {dashboard.decisions.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-zinc-600">Run the first aligned decision cycle. Observe mode is the safest starting point.</div>}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
