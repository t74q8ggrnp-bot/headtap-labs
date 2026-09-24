"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { HtAgentTargetCalibrationSummary, HtTradePlan } from "@/lib/ht-agent/contracts";
import HtTradePlanCard from "./HtTradePlanCard";

type TradePlanFeed = {
  plans: Array<{
    symbol: string;
    decidedAt: string;
    current: boolean;
    ageSeconds: number | null;
    plan: HtTradePlan;
  }>;
  targetCalibration?: HtAgentTargetCalibrationSummary | null;
};

export type HomeTradePlanState =
  | "loading"
  | "available"
  | "signed_out"
  | "unavailable"
  | "error";

export default function HomeTradePlan({
  symbol,
  compact = false,
  onPlanChange,
  onPlanStateChange,
  showCard = true,
}: {
  symbol: string;
  compact?: boolean;
  onPlanChange?: (plan: HtTradePlan | null) => void;
  onPlanStateChange?: (state: HomeTradePlanState) => void;
  showCard?: boolean;
}) {
  const [feed, setFeed] = useState<TradePlanFeed | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [planState, setPlanState] = useState<HomeTradePlanState>("loading");

  const refresh = useCallback(async () => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    setSignedIn(Boolean(token));
    if (!token) {
      setFeed(null);
      setPlanState("signed_out");
      setError("");
      return;
    }
    const response = await fetch(
      `/api/ht-agent?view=trade_plans&symbol=${encodeURIComponent(symbol)}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body = await response.json() as { ok?: boolean; tradePlans?: TradePlanFeed; error?: string };
    if (!response.ok || !body.ok || !body.tradePlans) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Your HT Agent session has expired. Sign in again to continue."
          : "The paper-only HT Trade Plan is temporarily unavailable.",
      );
    }
    setFeed(body.tradePlans);
    setPlanState(body.tradePlans.plans.some((item) => item.symbol === symbol)
      ? "available"
      : "unavailable");
    setError("");
  }, [symbol]);

  useEffect(() => {
    let mounted = true;
    const run = () => void refresh().catch((reason) => {
      if (mounted) {
        setPlanState("error");
        setError(reason instanceof Error ? reason.message : "HT Trade Plan is unavailable.");
      }
    });
    run();
    const timer = window.setInterval(run, 30_000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => run());
    return () => {
      mounted = false;
      window.clearInterval(timer);
      subscription.unsubscribe();
    };
  }, [refresh]);

  const selected = feed?.plans.find((item) => item.symbol === symbol) ?? null;

  useEffect(() => {
    onPlanChange?.(selected?.plan ?? null);
  }, [onPlanChange, selected?.plan]);

  useEffect(() => {
    onPlanStateChange?.(planState);
  }, [onPlanStateChange, planState]);

  // Mobile Home already presents verified Agent targets beside the quote.
  // Keep the same single feed subscription without duplicating the card below
  // the chart, where Pro X evidence now has the immediate context position.
  if (!showCard) return null;

  if (selected) return <HtTradePlanCard plan={selected.plan} current={selected.current} compact={compact} calibration={feed?.targetCalibration ?? null} />;

  return (
    <section className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.035] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.22em] text-cyan-300">HT Agent X Setup Forming</p>
          <p className="mt-1 text-sm font-black text-violet-300">ANALYSIS FORMING</p>
        </div>
        <Link href="/agent" className="rounded-lg border border-violet-400/20 px-3 py-2 text-[9px] font-black text-violet-300">Open HT Agent</Link>
      </div>
      <p className="mt-2 text-[10px] font-semibold leading-4 text-zinc-500">
        {!signedIn
          ? "Sign in to create your isolated paper-only decision profile."
          : error || `HT Agent has not persisted a current aligned plan for ${symbol}. The page will not invent one.`}
      </p>
    </section>
  );
}
