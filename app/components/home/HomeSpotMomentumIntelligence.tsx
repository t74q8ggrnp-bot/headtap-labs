"use client";

import Link from "next/link";
import { useState } from "react";
import HomeTradePlan, { type HomeTradePlanState } from "@/app/components/agent/HomeTradePlan";
import type { TradeFrameworkDisplay } from "@/lib/contracts/market";
import type { HtTradePlan } from "@/lib/ht-agent/contracts";
import { formatMarketPrice } from "@/lib/market-price-format";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";

type Props = {
  opportunity: Opportunity;
  framework: TradeFrameworkDisplay | null;
  displayPrice: number | null;
  displayChange: number | null;
  liveLabel: string;
  watched: boolean;
  watchlistBusy: boolean;
  onToggleWatchlist: () => void;
};

const targetPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? formatMarketPrice(value) : "Forming";

const percentChange = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const entryPrice = (plan: HtTradePlan | null) =>
  plan?.entryZone
    ? `${formatMarketPrice(plan.entryZone.low)}–${formatMarketPrice(plan.entryZone.high)}`
    : "Forming";

export default function HomeSpotMomentumIntelligence({
  opportunity,
  framework,
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
  const laneLabel = opportunity.strategy === "before_the_crowd" ? "Before the Crowd" : "Spot Momentum";
  const prox = opportunity.proxIntelligence;
  const proxState = prox && prox.status !== "unavailable"
    ? (prox.pulse?.state ?? prox.status).replaceAll("_", " ")
    : "Unavailable";
  const evidence = opportunity.signals.slice(0, 5);
  const continuity = opportunity.sessionContinuity;
  const riskMeasured = framework !== null || opportunity.explosionAssessment?.scenarioBands?.structuralRisk !== null;
  const distance = (target: number | null | undefined) => (
    typeof target === "number" && displayPrice !== null && displayPrice > 0
      ? `${target >= displayPrice ? "+" : ""}${((target / displayPrice - 1) * 100).toFixed(1)}%`
      : null
  );

  return (
    <section className="ht-home-spot-intelligence" aria-labelledby="ht-home-spot-title">
      <header className="ht-home-spot-intelligence__header">
        <p id="ht-home-spot-title">{laneLabel}</p>
        <span>{opportunity.scannedAt ? `Decision ${new Date(opportunity.scannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Canonical decision"}</span>
      </header>

      <div className="ht-home-spot-intelligence__quote">
        <h2>{opportunity.ticker}</h2>
        <strong className="ht-tabular-numbers">{displayPrice === null ? "—" : formatMarketPrice(displayPrice)}</strong>
        {displayChange === null ? null : (
          <span className={`ht-tabular-numbers ${displayChange >= 0 ? "is-positive" : "is-negative"}`}>{percentChange(displayChange)}</span>
        )}
        <small>{liveLabel}</small>
      </div>

      <dl className="ht-home-spot-intelligence__facts">
        <div><dt>HT score</dt><dd className="ht-tabular-numbers">{Math.round(opportunity.opportunityScore)}</dd></div>
        <div><dt>Setup</dt><dd>{opportunity.stage.replaceAll("_", " ")}</dd></div>
      </dl>

      {continuity ? (
        <p className="ht-home-spot-continuity">
          <strong>Session continuity · {continuity.label}</strong>
          <span>
            {continuity.previousClose === null
              ? continuity.summary
              : `Prev close ${formatMarketPrice(continuity.previousClose)}${continuity.gapPercent === null ? "" : ` · Gap ${percentChange(continuity.gapPercent)}`}${continuity.gapRetentionPercent === null ? "" : ` · ${continuity.gapRetentionPercent.toFixed(0)}% retained`}`}
          </span>
        </p>
      ) : null}

      <section className="ht-home-spot-targets" aria-label="HT Agent X plan">
        <h3>HT Agent X plan</h3>
        <div>
          <p><span>Entry zone</span><strong className="ht-tabular-numbers">{entryPrice(plan)}</strong></p>
          <p><span>Target 1 {distance(plan?.targetOne) ? `· ${distance(plan?.targetOne)}` : ""}</span><strong className="ht-tabular-numbers">{targetPrice(plan?.targetOne)}</strong></p>
          <p><span>Target 2 {distance(plan?.targetTwo) ? `· ${distance(plan?.targetTwo)}` : ""}</span><strong className="ht-tabular-numbers">{targetPrice(plan?.targetTwo)}</strong></p>
          <p><span>Invalidation</span><strong className="ht-tabular-numbers">{targetPrice(plan?.invalidation)}</strong></p>
        </div>
        {planState === "available" ? null : (
          <small>
            {planState === "signed_out"
              ? "Sign in to view your current Agent X plan."
              : planState === "loading"
                ? "Checking the aligned Agent X plan…"
                : "No aligned Agent X targets are currently formed."}
          </small>
        )}
        <HomeTradePlan
          symbol={opportunity.ticker}
          showCard={false}
          onPlanChange={setPlan}
          onPlanStateChange={setPlanState}
        />
      </section>

      <p className="ht-home-spot-intelligence__read">{opportunity.whyItMatters}</p>

      <section className="ht-home-spot-prox-pulse" aria-label="Pro X pulse">
        <strong>Pro X pulse <span>· {proxState}</span></strong>
        <p>
          {prox && prox.status !== "unavailable"
            ? "Bounded live-tape evidence supports the current Canonical read."
            : "No fresh bounded Pro X pulse is attached. Canonical remains the decision authority."}
        </p>
      </section>

      {!riskMeasured ? (
        <p className="ht-home-spot-intelligence__withheld">Risk and R/R are withheld until verified support and invalidation structure are measurable.</p>
      ) : null}

      <nav className="ht-home-spot-intelligence__actions" aria-label={`${opportunity.ticker} actions`}>
        <Link href={`/market?ticker=${encodeURIComponent(opportunity.ticker)}`}>Open Market ↗</Link>
        <button type="button" disabled={watchlistBusy} aria-pressed={watched} onClick={onToggleWatchlist}>{watched ? "★ Watching" : "☆ Watch"}</button>
        <Link href={`/paper?symbol=${encodeURIComponent(opportunity.ticker)}`}>Review in Paper</Link>
      </nav>

      <details className="ht-home-spot-intelligence__disclosure">
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
