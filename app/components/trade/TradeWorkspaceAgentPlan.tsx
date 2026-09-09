"use client";

import Link from "next/link";
import { useState } from "react";
import type { AgentXVisualPlanRead } from "@/lib/ht-agent/visual-plan-api";
import { visualPlanPaperUrl } from "@/lib/ht-agent/visual-plan-api";
import { formatMarketPrice } from "@/lib/market-price-format";

const lifecycleLabel = {
  watching: "Watching",
  triggered: "Triggered",
  target_reached: "Target reached",
  invalidated: "Invalidated",
  expired: "Expired",
  needs_review_ambiguous: "Needs review",
} as const;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export default function TradeWorkspaceAgentPlan({ read }: { read: AgentXVisualPlanRead | null }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!read?.visible) return null;
  if (!read.plan) {
    return (
      <section className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.018] px-4 py-3" aria-label="Agent X visual paper plan">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">Agent X · Paper only</p>
            <p className="mt-1 text-sm font-black text-zinc-300">No current plan</p>
          </div>
          <p className="max-w-xs text-right text-[9px] font-semibold leading-4 text-zinc-600">A complete, current and measurable paper plan is not available for this symbol.</p>
        </div>
      </section>
    );
  }
  const { definition, lifecycleState } = read.plan;
  const planFreshness = read.chartObjects.find(
    (object) => object.authority === "agent" && object.type !== "event_marker",
  )?.timing.freshness ?? "stale";
  const detailBody = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Entry", `${formatMarketPrice(definition.entryZone.low)}–${formatMarketPrice(definition.entryZone.high)}`],
          ["Stop", formatMarketPrice(definition.stopPrice)],
          ["Target 1", formatMarketPrice(definition.targetOne)],
          ["Target 2", formatMarketPrice(definition.targetTwo)],
          ["Est. R/R", `${definition.estimatedRiskReward.toFixed(2)}R`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5">
            <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-600">{label}</p>
            <p className="mt-1 font-mono text-[10px] font-black text-zinc-200">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Max quantity", definition.positionRisk.quantity.toLocaleString()],
          ["Est. notional", money.format(definition.positionRisk.estimatedNotional)],
          ["Maximum risk", money.format(definition.positionRisk.maximumRisk)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5">
            <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-600">{label}</p>
            <p className="mt-1 font-mono text-[9px] font-black text-zinc-300">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="text-[8px] font-black uppercase tracking-[0.14em] text-green-300">Why this plan exists</p><p className="mt-1 text-[10px] font-semibold leading-5 text-zinc-500">{definition.explanation.whyThisPlanExists}</p></div>
        <div><p className="text-[8px] font-black uppercase tracking-[0.14em] text-red-300">What cancels it</p><p className="mt-1 text-[10px] font-semibold leading-5 text-zinc-500">{definition.explanation.whatCancelsThisPlan}</p></div>
      </div>
      <p className="text-[9px] font-semibold leading-4 text-zinc-600">Risk guidance: {definition.explanation.riskNote}</p>
      <p className="text-[8px] font-semibold text-zinc-700">Massive provider evidence {new Date(definition.provenance.marketProviderAt).toLocaleTimeString()} · freshness {planFreshness.replaceAll("_", " ")} · expires {new Date(definition.expiresAt).toLocaleTimeString()} · no overnight carry</p>
    </div>
  );
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-violet-400/15 bg-violet-500/[0.035]" aria-label="Agent X visual paper plan">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">Agent X · Visual paper plan</p>
          <p className="mt-1 text-sm font-black text-white">{lifecycleLabel[lifecycleState]} · Long above {formatMarketPrice(definition.triggerPrice)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDetailsOpen(true)} className="min-h-11 rounded-xl border border-white/10 px-4 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-300 md:hidden">Plan details</button>
          {read.plan.paperHandoffEligible ? (
            <Link href={visualPlanPaperUrl({ symbol: definition.symbol, planVersionId: read.plan.planVersionId })} className="inline-flex min-h-11 items-center rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase tracking-[0.1em] text-black">Review in Paper</Link>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-xl border border-white/[0.07] px-4 text-[8px] font-black uppercase tracking-[0.08em] text-zinc-600">Paper review locked</span>
          )}
        </div>
      </div>
      <div className="hidden border-t border-white/[0.06] px-4 py-4 md:block">{detailBody}</div>
      {detailsOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 md:hidden" role="dialog" aria-modal="true" aria-label="Agent X plan details" onClick={() => setDetailsOpen(false)}>
          <div className="max-h-[78dvh] w-full overflow-y-auto rounded-t-[24px] border border-white/10 bg-[#0a0d10] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-700" />
            {detailBody}
            <button type="button" onClick={() => setDetailsOpen(false)} className="mt-5 min-h-12 w-full rounded-xl border border-white/10 text-[10px] font-black uppercase tracking-[0.12em] text-white">Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
