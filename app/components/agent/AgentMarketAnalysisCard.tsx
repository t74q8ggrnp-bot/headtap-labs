"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { MarketChartDisplayQuote, MarketChartResponse } from "@/lib/market-chart";
import { formatMarketPrice } from "@/lib/market-price-format";
import { deriveHtAgentMarketAnalysis } from "@/lib/ht-agent/market-analysis";

function formatProviderTime(timestamp: string) {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "Provider time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(parsed);
}

function relationship(price: number, reference: number | null) {
  if (reference === null || !(reference > 0)) return "Unavailable";
  const difference = ((price - reference) / reference) * 100;
  return `${difference >= 0 ? "Above" : "Below"} ${Math.abs(difference).toFixed(2)}%`;
}

const marketStructureLabel = {
  strong: "Strengthening",
  constructive: "Constructive",
  mixed: "Neutral",
  weakening: "Weakening",
  weak: "Defensive",
} as const;

export default function AgentMarketAnalysisCard({
  symbol,
  chart,
  quote,
  marketLabel,
  planServiceError = "",
}: {
  symbol: string;
  chart: MarketChartResponse | null;
  quote: MarketChartDisplayQuote | null;
  marketLabel: string;
  planServiceError?: string;
}) {
  const analysis = useMemo(() => deriveHtAgentMarketAnalysis({
    bars: chart?.bars ?? [],
    quote,
  }), [chart?.bars, quote]);
  const score = chart?.marketScore ?? null;
  const assetLabel = score?.assetKind === "etf"
    ? "ETF Market Context"
    : score?.assetKind === "stock"
      ? "Equity Market Context"
      : "Exact-Ticker Market Context";

  if (!analysis) {
    return (
      <section className="ht-agent-market-read" aria-label={`${symbol} Agent X market analysis`}>
        <p className="ht-agent-market-read__eyebrow">HT Agent X Market Analysis</p>
        <div className="ht-agent-market-read__title-row">
          <h3>VERIFYING MARKET FRAME</h3>
          <span>Research only</span>
        </div>
        <p className="ht-agent-market-read__copy">
          Waiting for the shared provider-backed chart frame for {symbol}. No setup, score, target, or risk level will be invented.
        </p>
      </section>
    );
  }

  return (
    <section className="ht-agent-market-read" aria-label={`${symbol} Agent X market analysis`}>
      <div className="ht-agent-market-read__heading">
        <div>
          <p className="ht-agent-market-read__eyebrow">HT Agent X Market Analysis</p>
          <h3>{analysis.headline}</h3>
        </div>
        <span className={`ht-agent-market-read__state is-${analysis.state}`}>{assetLabel}</span>
      </div>
      <p className="ht-agent-market-read__copy">{analysis.explanation}</p>
      {score ? (
        <div className="ht-agent-market-read__score" aria-label={`${symbol} HT Market Score Beta`}>
          <div className="ht-agent-market-read__structure">
            <span>Current structure</span>
            <strong>{marketStructureLabel[score.state]}</strong>
          </div>
          <div className="ht-agent-market-read__research-score">
            <strong>{score.score}/100</strong>
            <span>Research reading</span>
          </div>
          <p><span aria-hidden="true" />Live logged · {score.assetKind === "etf" ? "ETF" : score.assetKind === "stock" ? "Stock" : "Classification pending"}</p>
        </div>
      ) : (
        <p className="ht-agent-market-read__score-pending">Current structure · waiting for a persisted research receipt</p>
      )}
      <dl className="ht-agent-market-read__facts">
        <div><dt>VWAP</dt><dd>{analysis.vwap === null ? "Unavailable" : `${formatMarketPrice(analysis.vwap)} · ${relationship(analysis.price, analysis.vwap)}`}</dd></div>
        <div><dt>EMA 9</dt><dd>{analysis.ema9 === null ? "Unavailable" : `${formatMarketPrice(analysis.ema9)} · ${relationship(analysis.price, analysis.ema9)}`}</dd></div>
        <div><dt>Observed range</dt><dd>{formatMarketPrice(analysis.observedLow)}–{formatMarketPrice(analysis.observedHigh)}</dd></div>
        <div><dt>Range position</dt><dd>{analysis.rangePositionPercent === null ? "Unavailable" : `${analysis.rangePositionPercent.toFixed(1)}%`}</dd></div>
      </dl>
      <div className="ht-agent-market-read__receipt">
        <span>{marketLabel}</span>
        <span>{formatProviderTime(analysis.asOf)}</span>
        <span>{analysis.barCount} verified intervals</span>
      </div>
      <p className="ht-agent-market-read__boundary">
        {score?.assetKind === "etf" ? `${symbol} is ETF market context, not a Canonical opportunity. ` : ""}
        No Canonical rank, Agent target, entry, stop, Paper eligibility, or execution authority is implied.
      </p>
      {planServiceError ? <p className="ht-agent-market-read__service-note">Canonical plan check: {planServiceError}</p> : null}
      <Link href="/agent" className="ht-agent-market-read__link">Open HT Agent</Link>
    </section>
  );
}
