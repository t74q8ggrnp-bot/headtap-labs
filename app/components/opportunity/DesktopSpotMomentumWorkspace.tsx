"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMarketPrice } from "@/lib/market-price-format";
import type { DecisionTraceDisplay, TradeFrameworkDisplay } from "@/lib/contracts/market";
import type { HtTradePlan } from "@/lib/ht-agent/contracts";
import {
  getOpportunityPresentation,
  type Opportunity,
} from "@/lib/opportunity-model";
import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";
import HomeTradePlan, { type HomeTradePlanState } from "@/app/components/agent/HomeTradePlan";
import HeroPriceChart from "@/app/components/market/HeroPriceChart";
import DecisionTrace from "./DecisionTrace";
import MomentumContenders from "./MomentumContenders";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityRead from "./OpportunityRead";
import ProxPulse from "./ProxPulse";

export type DesktopMarketContext = {
  spy: { price: number; change: number; rvol: number | null; asOf?: string };
  qqq: { price: number; change: number; rvol: number | null; asOf?: string };
  iwm: { price: number; change: number; rvol: number | null; asOf?: string };
  vix: { price: number; change: number; asOf?: string } | null;
  mood: string;
  moodColor: string;
  volumeEnv: string;
  avgRvol: number | null;
  sourceTimestamp?: string | null;
};

type Props = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  trace: DecisionTraceDisplay | null;
  narrative: string | null;
  narrativeLoading: boolean;
  dualEngine: boolean;
  watched: boolean;
  decisionLabel: string;
  marketContext: DesktopMarketContext | null;
  contenders: Opportunity[];
  radarCandidates: Opportunity[];
  onOpen: () => void;
  onWatch: () => void;
  onSelectContender: (opportunity: Opportunity) => void;
};

const targetPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? formatMarketPrice(value)
    : "Forming";

export default function DesktopSpotMomentumWorkspace({
  opportunity,
  framework,
  trace,
  narrative,
  narrativeLoading,
  dualEngine,
  watched,
  decisionLabel,
  marketContext,
  contenders,
  radarCandidates,
  onOpen,
  onWatch,
  onSelectContender,
}: Props) {
  const marketView = useLiveMarketView(opportunity.ticker);
  const [plan, setPlan] = useState<HtTradePlan | null>(null);
  const [planState, setPlanState] = useState<HomeTradePlanState>("loading");
  const quote = marketView.quote;
  const displayPrice = quote?.price ?? opportunity.price;
  const displayChange = quote?.changePercent ?? opportunity.change;
  const view = getOpportunityPresentation(opportunity);
  const explosion = opportunity.explosionAssessment;
  const scenario = explosion?.scenarioBands ?? null;
  const riskMeasured = framework !== null || scenario?.structuralRisk !== null;
  const contextTone = marketContext?.moodColor === "red"
    ? "text-red-300"
    : marketContext?.moodColor === "green"
      ? "text-emerald-300"
      : "text-zinc-400";
  const contextTime = marketContext?.sourceTimestamp
    ? new Date(marketContext.sourceTimestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div className="ht-desktop-spot-workspace">
      <section className="ht-desktop-spot-workspace__hero" aria-labelledby="desktop-spot-title">
        <div className="ht-desktop-spot-workspace__summary">
          <div className="flex items-center justify-between gap-3">
            <p id="desktop-spot-title" className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-violet-300">
              Spot Momentum
            </p>
            <span className="text-[10px] font-bold tabular-nums text-zinc-600">{decisionLabel}</span>
          </div>

          <div className="mt-7">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <strong className="text-[clamp(2.8rem,4.2vw,4.75rem)] font-extrabold leading-none tracking-[-0.07em] text-white">
                {opportunity.ticker}
              </strong>
              <span className="pb-1 font-mono text-xl font-black tabular-nums text-white">
                {formatMarketPrice(displayPrice)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span className={`font-mono text-sm font-black tabular-nums ${displayChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)}%
              </span>
              <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-zinc-500">
                {marketView.live ? "Live quote" : marketView.label}
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-y border-white/[0.07] py-4">
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-zinc-600">HT score</p>
              <p className="mt-1 font-mono text-2xl font-black tabular-nums text-violet-300">{Math.round(opportunity.opportunityScore)}</p>
            </div>
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-zinc-600">Setup</p>
              <p className="mt-1 text-sm font-extrabold text-zinc-200">{opportunity.stage}</p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-blue-300">HT Agent X targets</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <span className="text-[9px] font-bold text-zinc-600">Target 1</span>
                <p className="mt-1 font-mono text-base font-black tabular-nums text-orange-400">{targetPrice(plan?.targetOne)}</p>
              </div>
              <div>
                <span className="text-[9px] font-bold text-zinc-600">Target 2</span>
                <p className="mt-1 font-mono text-base font-black tabular-nums text-orange-400">{targetPrice(plan?.targetTwo)}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] font-semibold leading-4 text-zinc-600">
              {planState === "available"
                ? "Verified Agent X plan levels."
                : planState === "signed_out"
                  ? "Sign in to view your current Agent X plan."
                  : planState === "loading"
                    ? "Checking the aligned Agent X plan…"
                    : "No aligned Agent X targets are currently formed."}
            </p>
            <HomeTradePlan
              symbol={opportunity.ticker}
              showCard={false}
              onPlanChange={setPlan}
              onPlanStateChange={setPlanState}
            />
          </div>

          <div className="mt-5 text-[11px] font-semibold leading-5 text-zinc-500">
            {opportunity.whyItMatters}
          </div>

          <div className="mt-5 rounded-xl bg-white/[0.025] px-3 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`text-[10px] font-extrabold ${contextTone}`}>
                Broad market: {marketContext?.mood ?? "Updating"}
              </span>
              {marketContext && (
                <>
                  <span className={`font-mono text-[10px] font-bold tabular-nums ${marketContext.spy.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    SPY {marketContext.spy.change >= 0 ? "+" : ""}{marketContext.spy.change.toFixed(2)}%
                  </span>
                  <span className={`font-mono text-[10px] font-bold tabular-nums ${marketContext.qqq.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    QQQ {marketContext.qqq.change >= 0 ? "+" : ""}{marketContext.qqq.change.toFixed(2)}%
                  </span>
                </>
              )}
            </div>
            <p className="mt-1 text-[8px] font-semibold text-zinc-700">
              {contextTime ? `Provider snapshot ${contextTime} · updates about every 15 seconds` : "Loading verified provider context"}
            </p>
          </div>

          {!riskMeasured && (
            <p className="mt-4 text-[10px] font-semibold leading-4 text-zinc-600">
              Risk and R/R are withheld until verified support and invalidation structure are measurable.
            </p>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
            <button type="button" onClick={onOpen} className="text-xs font-extrabold text-violet-300 transition hover:text-white">
              Full breakdown →
            </button>
            <Link href={`/market?ticker=${encodeURIComponent(opportunity.ticker)}`} className="text-xs font-extrabold text-orange-400 transition hover:text-orange-300">
              Open Market ↗
            </Link>
            <button type="button" onClick={onWatch} className="text-xs font-extrabold text-zinc-500 transition hover:text-white">
              {watched ? "★ Watching" : "☆ Watch"}
            </button>
          </div>
        </div>

        <div className="ht-desktop-spot-workspace__chart">
          <HeroPriceChart
            asset="stock"
            symbol={opportunity.ticker}
            accent="violet"
            height="clamp(390px, 51vh, 555px)"
            title="Live price history"
            visibleRange="2h"
            fillAvailableHeight
          />
        </div>
      </section>

      <section className="ht-desktop-spot-workspace__evidence" aria-label="Pro X and HT evidence">
        <div>
          {opportunity.proxIntelligence && opportunity.proxIntelligence.status !== "unavailable" ? (
            <ProxPulse packet={opportunity.proxIntelligence} />
          ) : (
            <div className="rounded-xl bg-white/[0.02] p-4">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-300">Pro X</p>
              <p className="mt-2 text-xs font-semibold text-zinc-500">No fresh bounded Pro X pulse is attached. Canonical remains the decision authority.</p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-4">
            <p className="font-mono text-4xl font-black tabular-nums text-violet-300">{Math.round(opportunity.opportunityScore)}</p>
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-zinc-600">Canonical opportunity score</p>
              <p className="mt-1 text-sm font-extrabold leading-5 text-zinc-200">{opportunity.whatChanged}</p>
              <p className="mt-1 text-[10px] font-semibold text-zinc-600">{dualEngine ? "Canonical and catalyst evidence are aligned." : `${view.positionLabel} opportunity state.`}</p>
            </div>
          </div>
          <OpportunityMetrics opportunity={opportunity} />
          <details className="rounded-xl bg-white/[0.02] px-4 py-3">
            <summary className="cursor-pointer text-[10px] font-extrabold text-zinc-400">Full score evidence</summary>
            <div className="mt-3 space-y-3">
              <OpportunityRead opportunity={opportunity} loading={narrativeLoading} narrative={narrative} />
              {trace && <DecisionTrace trace={trace} />}
            </div>
          </details>
        </div>
      </section>

      <div className="ht-desktop-spot-workspace__contenders">
        <MomentumContenders
          candidates={contenders}
          radarCandidates={radarCandidates}
          onSelect={onSelectContender}
        />
      </div>
    </div>
  );
}
