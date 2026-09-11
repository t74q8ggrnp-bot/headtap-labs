"use client";

import Link from "next/link";
import { formatMarketPrice } from "@/lib/market-price-format";
import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";
import type { DecisionTraceDisplay, TradeFrameworkDisplay } from "@/lib/contracts/market";
import {
  getOpportunityPresentation,
  type Opportunity,
} from "@/lib/opportunity-model";
import DecisionTrace from "./DecisionTrace";
import OpportunityMetrics from "./OpportunityMetrics";
import OpportunityWindow from "./OpportunityWindow";
import PriceDiscoveryWindow from "./PriceDiscoveryWindow";
import ProxPulse from "./ProxPulse";
import HeroPriceChart from "@/app/components/market/HeroPriceChart";
import HomeTradePlan from "@/app/components/agent/HomeTradePlan";

type MobileSpotMomentumCardProps = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  trace: DecisionTraceDisplay | null;
  narrative: string | null;
  dualEngine: boolean;
  watched: boolean;
  onOpen: () => void;
  onWatch: () => void;
};

export default function MobileSpotMomentumCard({
  opportunity,
  framework,
  trace,
  narrative,
  dualEngine,
  watched,
  onOpen,
  onWatch,
}: MobileSpotMomentumCardProps) {
  const view = getOpportunityPresentation(opportunity);
  const catalyst = opportunity.catalystTags[0] ?? null;
  const marketView = useLiveMarketView(opportunity.ticker, { chart: true });
  const displayQuote = marketView.quote;
  const displayPrice = displayQuote?.price ?? opportunity.price;
  const displayChange = displayQuote?.changePercent ?? opportunity.change;
  const displayLive = marketView.live;

  return (
    <article className="ht-mobile-home-card mx-4 mb-3 mt-4 flex-shrink-0 overflow-hidden" aria-labelledby={`mobile-home-${opportunity.ticker}`}>
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]" />
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-violet-400">Top Opportunity</p>
        </div>
        {dualEngine && <span className="text-[8px] font-black text-amber-400">⚡ Dual Signal</span>}
      </div>

      <div className="border-b border-white/8 px-5 pb-4" data-home-priority="1-ticker-price">
        <div className="mb-2 flex items-end gap-3">
          <h2 id={`mobile-home-${opportunity.ticker}`} className="font-mono text-[2.8rem] font-black leading-none tracking-[-0.06em] text-white">{opportunity.ticker}</h2>
          <div className="pb-1">
            <span className="font-mono text-base font-black text-white">{formatMarketPrice(displayPrice)}</span>
            <span className={`ml-2 font-mono text-xs font-black ${displayChange >= 0 ? "text-green-400" : "text-red-400"}`}>
              {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)}%
            </span>
            {displayLive && (
              <span className="ml-2 text-[7px] font-black uppercase tracking-[0.14em] text-green-400">
                Live
              </span>
            )}
          </div>
        </div>
        {!displayLive && (
          <p className="mb-2 text-[9px] font-semibold text-zinc-500">
            {displayQuote ? marketView.label : opportunity.freshnessLabel}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[9px] font-black text-zinc-400">{opportunity.stage}</span>
          <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black ${view.positionLabel === "EARLY" ? "border-green-400/20 bg-green-500/[0.06] text-green-400" : "border-zinc-700 text-zinc-600"}`}>
            {view.positionLabel}
          </span>
          {catalyst && <span className="rounded-full border border-orange-400/25 bg-orange-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-orange-300">⚡ {catalyst}</span>}
        </div>
      </div>

      <div className="border-b border-white/8 px-4 py-3" data-home-priority="2-chart">
        <HeroPriceChart asset="stock" symbol={opportunity.ticker} accent="violet" compact />
      </div>

      <div className="border-b border-white/8 px-5 py-4" data-home-priority="3-score-signal">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-xs font-bold text-zinc-500">HT score</p>
            <p className="font-mono text-3xl font-black leading-none text-violet-300">{Math.round(opportunity.opportunityScore)}</p>
          </div>
          <p className="text-xs font-bold text-violet-300">{view.confidenceLabel} confidence</p>
        </div>
        <OpportunityMetrics opportunity={opportunity} />
      </div>

      <div data-home-priority="4-levels-risk">
        <div className="border-b border-white/8 px-5 py-4">
          <h3 className="mb-3 text-xs font-bold text-zinc-400">Levels and risk</h3>
          <HomeTradePlan symbol={opportunity.ticker} compact />
          {opportunity.riskTags.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs font-semibold text-red-300" aria-label="Risk flags">
              {opportunity.riskTags.map((tag) => <li key={tag}>Risk flag: {tag}</li>)}
            </ul>
          )}
        </div>
        {framework && <OpportunityWindow framework={framework} compact />}
        {opportunity.explosionAssessment?.state === "price_discovery" && (
          <div className="border-b border-white/8 px-5 py-4">
            <PriceDiscoveryWindow assessment={opportunity.explosionAssessment} />
          </div>
        )}
      </div>

      <div data-home-priority="5-extended-interpretation">
        <div className="border-b border-white/8 px-5 py-4">
          <h3 className="mb-1 text-xs font-bold text-zinc-400">Interpretation</h3>
          <p className="text-sm font-semibold leading-6 text-zinc-300">{opportunity.whyItMatters}</p>
        </div>

        {opportunity.signals.length > 0 && (
          <div className="border-b border-white/8 px-5 py-4">
            <h3 className="mb-2 text-xs font-bold text-zinc-400">Supporting evidence</h3>
            <ul className="space-y-2">
              {opportunity.signals.slice(0, 4).map((signal, index) => (
                <li key={`${signal}-${index}`} className="text-xs font-semibold leading-5 text-zinc-500">{signal}</li>
              ))}
            </ul>
          </div>
        )}

        {opportunity.proxIntelligence && opportunity.proxIntelligence.status !== "unavailable" && (
          <div className="border-b border-white/8 px-5 py-4"><ProxPulse packet={opportunity.proxIntelligence} /></div>
        )}

        {narrative && (
          <div className="border-b border-white/8 px-5 py-4">
            <h3 className="mb-1 text-xs font-bold text-zinc-400">Extended HT read</h3>
            <p className="text-xs font-semibold italic leading-5 text-zinc-500">“{narrative}”</p>
          </div>
        )}

        {trace && <div className="border-b border-white/8 px-5 py-4"><DecisionTrace trace={trace} /></div>}
      </div>

      <div className="px-5 py-4">
        <div className="flex gap-2">
          <button onClick={onOpen} className="flex-1 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] py-3 text-xs font-black text-violet-300">Full Signal Breakdown →</button>
          <button onClick={onWatch} className={`rounded-xl border px-4 py-3 text-xs font-black transition ${watched ? "border-violet-400/30 bg-violet-500/10 text-violet-300" : "border-white/8 bg-white/[0.02] text-zinc-600"}`}>
            {watched ? "★" : "☆"}
          </button>
        </div>
        <Link
          href={`/trade/${encodeURIComponent(opportunity.ticker)}`}
          className="mt-2 flex w-full items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] py-3 text-xs font-black text-cyan-300"
        >
          Open trading workspace ↗
        </Link>
        <p className="mt-2.5 text-center text-[8px] font-semibold text-zinc-700">Signals are for research only, not financial advice.</p>
      </div>
    </article>
  );
}
