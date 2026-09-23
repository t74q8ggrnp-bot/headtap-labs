"use client";

import Link from "next/link";
import { useState } from "react";
import HomeTradePlan, { type HomeTradePlanState } from "@/app/components/agent/HomeTradePlan";
import type { TradeFrameworkDisplay } from "@/lib/contracts/market";
import type { HtTradePlan } from "@/lib/ht-agent/contracts";
import { formatMarketPrice } from "@/lib/market-price-format";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";
import type { HomeMarketContext } from "./HomeReferenceSurface";

type Props = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  marketContext: HomeMarketContext | null;
  displayPrice: number | null;
  displayChange: number | null;
  liveLabel: string;
  watched: boolean;
  watchlistBusy: boolean;
  onToggleWatchlist: () => void;
};

const targetPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? formatMarketPrice(value) : "Forming";

const marketChange = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function HomeSpotMomentumIntelligence({
  opportunity,
  framework,
  marketContext,
  displayPrice,
  displayChange,
  liveLabel,
  watched,
  watchlistBusy,
  onToggleWatchlist,
}: Props) {
  const [plan, setPlan] = useState<HtTradePlan | null>(null);
  const [planState, setPlanState] = useState<HomeTradePlanState>("loading");
  const view = getOpportunityPresentation(opportunity);
  const prox = opportunity.proxIntelligence;
  const evidence = opportunity.signals.slice(0, 5);
  const riskMeasured = framework !== null || opportunity.explosionAssessment?.scenarioBands?.structuralRisk !== null;

  return (
    <section className="ht-home-spot-intelligence" aria-labelledby="ht-home-spot-title">
      <header className="ht-home-spot-intelligence__header">
        <p id="ht-home-spot-title">Spot Momentum</p>
        <span>{opportunity.scannedAt ? `Decision ${new Date(opportunity.scannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Canonical decision"}</span>
      </header>

      <div className="ht-home-spot-intelligence__quote">
        <h2>{opportunity.ticker}</h2>
        <strong className="ht-tabular-numbers">{displayPrice === null ? "—" : formatMarketPrice(displayPrice)}</strong>
        {displayChange === null ? null : (
          <span className={`ht-tabular-numbers ${displayChange >= 0 ? "is-positive" : "is-negative"}`}>{marketChange(displayChange)}</span>
        )}
        <small>{liveLabel}</small>
      </div>

      <dl className="ht-home-spot-intelligence__facts">
        <div><dt>HT score</dt><dd className="ht-tabular-numbers">{Math.round(opportunity.opportunityScore)}</dd></div>
        <div><dt>Setup</dt><dd>{opportunity.stage.replaceAll("_", " ")}</dd></div>
      </dl>

      <section className="ht-home-spot-targets" aria-label="HT Agent X targets">
        <h3>HT Agent X targets</h3>
        <div>
          <p><span>Target 1</span><strong className="ht-tabular-numbers">{targetPrice(plan?.targetOne)}</strong></p>
          <p><span>Target 2</span><strong className="ht-tabular-numbers">{targetPrice(plan?.targetTwo)}</strong></p>
        </div>
        <small>
          {planState === "available"
            ? "Verified Agent X plan levels."
            : planState === "signed_out"
              ? "Sign in to view your current Agent X plan."
              : planState === "loading"
                ? "Checking the aligned Agent X plan…"
                : "No aligned Agent X targets are currently formed."}
        </small>
        <HomeTradePlan
          symbol={opportunity.ticker}
          showCard={false}
          onPlanChange={setPlan}
          onPlanStateChange={setPlanState}
        />
      </section>

      <p className="ht-home-spot-intelligence__read">{opportunity.whyItMatters}</p>

      <section className="ht-home-spot-market" aria-label="Broad market context">
        <strong>Broad market: {marketContext?.mood ?? "Updating"}</strong>
        {marketContext ? (
          <div>
            <span className={marketContext.spy.change >= 0 ? "is-positive" : "is-negative"}>SPY {marketChange(marketContext.spy.change)}</span>
            <span className={marketContext.qqq.change >= 0 ? "is-positive" : "is-negative"}>QQQ {marketChange(marketContext.qqq.change)}</span>
          </div>
        ) : null}
      </section>

      {!riskMeasured ? (
        <p className="ht-home-spot-intelligence__withheld">Risk and R/R are withheld until verified support and invalidation structure are measurable.</p>
      ) : null}

      <nav className="ht-home-spot-intelligence__actions" aria-label={`${opportunity.ticker} actions`}>
        <Link href={`/market?ticker=${encodeURIComponent(opportunity.ticker)}`}>Open Market ↗</Link>
        <button type="button" disabled={watchlistBusy} aria-pressed={watched} onClick={onToggleWatchlist}>{watched ? "★ Watching" : "☆ Watch"}</button>
        <Link href={`/paper?symbol=${encodeURIComponent(opportunity.ticker)}`}>Review in Paper</Link>
      </nav>

      <details className="ht-home-spot-intelligence__disclosure" open>
        <summary>Pro X evidence</summary>
        <div>
          {prox && prox.status !== "unavailable" ? (
            <><strong>{(prox.pulse?.state ?? prox.status).replaceAll("_", " ")}</strong><p>{prox.event?.headline ?? "Bounded Pro X market evidence is attached to this Canonical decision."}</p></>
          ) : <p>No fresh bounded Pro X pulse is attached. Canonical remains the decision authority.</p>}
        </div>
      </details>

      <details className="ht-home-spot-intelligence__disclosure">
        <summary>Decision and levels</summary>
        <div>
          <p><strong>{view.momentumLabel}</strong> · {view.positionLabel} · {view.riskLabel}</p>
          {framework ? (
            <dl>
              <div><dt>Upside</dt><dd>{formatMarketPrice(framework.uptideMin)}–{formatMarketPrice(framework.uptideMax)}</dd></div>
              <div><dt>Risk zone</dt><dd>{formatMarketPrice(framework.riskZone)}</dd></div>
              <div><dt>Risk / reward</dt><dd>{framework.rr.toFixed(2)}R</dd></div>
            </dl>
          ) : <p>No verified structured level set is available.</p>}
        </div>
      </details>

      <details className="ht-home-spot-intelligence__disclosure">
        <summary>Full Canonical evidence</summary>
        <div>
          {evidence.length > 0 ? <ul>{evidence.map((signal, index) => <li key={`${signal}-${index}`}>{signal}</li>)}</ul> : <p>No additional evidence is available.</p>}
          <p>{opportunity.whatChanged}</p>
          <p>Engine: {opportunity.engineVersion}</p>
        </div>
      </details>
    </section>
  );
}
