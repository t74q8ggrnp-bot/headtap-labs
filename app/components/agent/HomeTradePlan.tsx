"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { HtTradePlan } from "@/lib/ht-agent/contracts";
import HtTradePlanCard from "./HtTradePlanCard";

type TradePlanFeed = {
  plans: Array<{
    symbol: string;
    decidedAt: string;
    current: boolean;
    ageSeconds: number | null;
    plan: HtTradePlan;
  }>;
};

export default function HomeTradePlan({
  symbol,
  compact = false,
}: {
  symbol: string;
  compact?: boolean;
}) {
  const [feed, setFeed] = useState<TradePlanFeed | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    setSignedIn(Boolean(token));
    if (!token) return;
    const response = await fetch("/api/ht-agent?view=trade_plans", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json() as { ok?: boolean; tradePlans?: TradePlanFeed; error?: string };
    if (!response.ok || !body.ok || !body.tradePlans) {
      throw new Error(body.error ?? "HT Trade Plan is unavailable.");
    }
    setFeed(body.tradePlans);
    setError("");
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = () => void refresh().catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : "HT Trade Plan is unavailable.");
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
  if (selected) return <HtTradePlanCard plan={selected.plan} current={selected.current} compact={compact} />;

  return (
    <section className="rounded-2xl border border-orange-400/15 bg-orange-500/[0.035] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.22em] text-cyan-300">HT Trade Plan · Paper Research</p>
          <p className="mt-1 text-sm font-black text-orange-300">DECISION PENDING</p>
        </div>
        <Link href="/agent" className="rounded-lg border border-orange-400/20 px-3 py-2 text-[9px] font-black text-orange-300">Open HT Agent</Link>
      </div>
      <p className="mt-2 text-[10px] font-semibold leading-4 text-zinc-500">
        {!signedIn
          ? "Sign in to create your isolated paper-only decision profile."
          : error || `HT Agent has not persisted a current aligned plan for ${symbol}. The page will not invent one.`}
      </p>
    </section>
  );
}
