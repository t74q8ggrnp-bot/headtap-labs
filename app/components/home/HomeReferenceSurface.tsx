"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import HomeTradePlan from "@/app/components/agent/HomeTradePlan";
import DesktopTerminalFrame from "@/app/components/terminal/DesktopTerminalFrame";
import type { TradeFrameworkDisplay } from "@/lib/contracts/market";
import { formatMarketPrice } from "@/lib/market-price-format";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";
import HomeReferenceChart from "./HomeReferenceChart";
import HomeTerminalMarkets from "./HomeTerminalMarkets";

export type HomeMarketContext = {
  spy: { price: number; change: number; rvol: number };
  qqq: { price: number; change: number; rvol: number };
  iwm: { price: number; change: number; rvol: number };
  vix: { price: number; change: number } | null;
  mood: string;
  moodColor: string;
  volumeEnv: string;
  avgRvol: number;
};

type Props = {
  opportunity: Opportunity | null;
  opportunities: Opportunity[];
  framework: TradeFrameworkDisplay | null;
  marketContext: HomeMarketContext | null;
  watchlist: string[];
  recents: string[];
  watched: boolean;
  watchlistBusy: boolean;
  loading: boolean;
  selectionLoading: boolean;
  selectionError: string;
  onSelect: (opportunity: Opportunity) => void;
  onToggleWatchlist: () => void;
};

const changeLabel = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const readable = (value: string | null | undefined) => value ? value.replaceAll("_", " ") : "Unavailable";

function providerTime(opportunity: Opportunity) {
  const timestamp = opportunity.displayQuoteAsOf ?? opportunity.scannedAt;
  if (!timestamp) return "Provider time pending";
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "Provider time pending";
  return `Provider ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  }).format(parsed)}`;
}

export default function HomeReferenceSurface({
  opportunity,
  opportunities,
  framework,
  marketContext,
  watchlist,
  recents,
  watched,
  watchlistBusy,
  loading,
  selectionLoading,
  selectionError,
  onSelect,
  onToggleWatchlist,
}: Props) {
  const [compactIntelligenceOpen, setCompactIntelligenceOpen] = useState(false);
  const compactIntelligenceTouched = useRef(false);

  useEffect(() => {
    const apply = () => {
      if (compactIntelligenceTouched.current) return;
      const portrait = window.innerWidth < 768;
      setCompactIntelligenceOpen(!portrait);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  if (!opportunity) {
    return (
      <main className="htb-home htb-home--state" aria-label="HT Labs Home">
        <div className="htb-home__loading" role="status" aria-live="polite">
          <span className="htb-live-dot" />
          <div>
            <h1>{loading ? "Loading market intelligence" : "No eligible opportunity"}</h1>
            <p>{loading ? "Connecting to the existing canonical feed." : "HT Labs will not invent a setup when the canonical gate has no eligible result."}</p>
          </div>
        </div>
      </main>
    );
  }

  const view = getOpportunityPresentation(opportunity);
  const eligible = opportunity.eligibility?.eligible === true;
  const prox = opportunity.proxIntelligence;
  const visibleEvidence = opportunity.signals.slice(0, 5);

  const marketTape = (
    <section className="htb-tape" aria-label="Market context" tabIndex={0}>
      {marketContext ? (
        <>
          <span className="htb-tape__session"><span className="htb-live-dot" />{marketContext.mood}</span>
          {[["SPY", marketContext.spy.change], ["QQQ", marketContext.qqq.change]].map(([label, change]) => (
            <span key={String(label)}><b>{label}</b> <em className={Number(change) >= 0 ? "is-positive" : "is-negative"}>{changeLabel(Number(change))}</em></span>
          ))}
          <span className="htb-tape__desktop-only"><b>IWM</b> <em className={marketContext.iwm.change >= 0 ? "is-positive" : "is-negative"}>{changeLabel(marketContext.iwm.change)}</em></span>
          {marketContext.vix ? <span className="htb-tape__desktop-only"><b>VIX</b> <em>{marketContext.vix.price.toFixed(1)}</em></span> : null}
          <span className="htb-tape__desktop-only"><b>VOL</b> <em>{marketContext.volumeEnv}</em></span>
          <details className="htb-tape__mobile-more">
            <summary>More</summary>
            <div aria-label="Additional market context">
              <span><b>IWM</b> <em className={marketContext.iwm.change >= 0 ? "is-positive" : "is-negative"}>{changeLabel(marketContext.iwm.change)}</em></span>
              {marketContext.vix ? <span><b>VIX</b> <em>{marketContext.vix.price.toFixed(1)}</em></span> : null}
              <span><b>VOL</b> <em>{marketContext.volumeEnv}</em></span>
            </div>
          </details>
        </>
      ) : <span role="status" aria-live="polite">Loading market context…</span>}
    </section>
  );

  const instrumentHeader = (
    <>
      {marketTape}
      <header className="htb-symbol-header ht-terminal-home-instrument" data-home-priority="1-ticker-price">
        <div className="ht-terminal-home-quote">
          <div className="htb-symbol-line">
            <h1 id="htb-symbol-title">{opportunity.ticker}</h1>
            <strong className="ht-tabular-numbers">{formatMarketPrice(opportunity.price)}</strong>
            <span className={`ht-tabular-numbers ${opportunity.change >= 0 ? "is-positive" : "is-negative"}`}>{changeLabel(opportunity.change)}</span>
          </div>
          <p>{readable(opportunity.scanSession)} · {providerTime(opportunity)}</p>
        </div>
        <div className="ht-terminal-home-actions">
          <button
            type="button"
            className="ht-terminal-action"
            aria-label={watched ? `Remove ${opportunity.ticker} from watchlist` : `Add ${opportunity.ticker} to watchlist`}
            aria-pressed={watched}
            disabled={watchlistBusy}
            onClick={onToggleWatchlist}
          >
            <span className="ht-home-action-icon" aria-hidden="true">{watched ? "★" : "☆"}</span>
            <span className="ht-home-action-label ht-home-action-label--mobile">{watched ? "Saved" : "Watch"}</span>
            <span className="ht-home-action-label ht-home-action-label--desktop">{watched ? "Watching" : "Watch"}</span>
          </button>
          <Link
            href={`/trade/${encodeURIComponent(opportunity.ticker)}`}
            className="htb-workspace-link"
            aria-label={`Open ${opportunity.ticker} workspace`}
          >
            <span className="ht-home-action-icon" aria-hidden="true">↗</span>
            <span className="ht-home-action-label ht-home-action-label--mobile">Trade</span>
            <span className="ht-home-action-label ht-home-action-label--desktop">Open workspace</span>
          </Link>
        </div>
      </header>
    </>
  );

  const chart = (
    <>
      <div className="htb-decision-line" data-home-priority="2-decision">
        <strong>{readable(opportunity.opportunityType)} · {Math.round(opportunity.opportunityScore)}</strong>
        <span>{opportunity.whatChanged || opportunity.whyItMatters}</span>
      </div>
      {selectionLoading ? <div className="htb-selection-state" role="status">Loading {opportunity.ticker} canonical context…</div> : null}
      {selectionError ? <div className="htb-selection-state htb-selection-state--error" role="status">{selectionError}</div> : null}
      <div data-home-priority="3-chart"><HomeReferenceChart symbol={opportunity.ticker} /></div>
    </>
  );

  const intelligence = (
    <section
      className="htb-intelligence-shell"
      data-open={compactIntelligenceOpen ? "true" : "false"}
      data-home-priority="4-intelligence"
    >
      <button
        type="button"
        className="htb-intelligence-toggle"
        aria-expanded={compactIntelligenceOpen}
        aria-controls="htb-intelligence-content"
        onClick={() => {
          compactIntelligenceTouched.current = true;
          setCompactIntelligenceOpen((open) => !open);
        }}
      >
        <span>HT Intelligence</span>
        <strong className="ht-tabular-numbers">{Math.round(opportunity.opportunityScore)}</strong>
        <span aria-hidden="true">{compactIntelligenceOpen ? "−" : "+"}</span>
      </button>
      <div id="htb-intelligence-content" className="htb-intelligence">
      <h2 className="sr-only">HT Intelligence</h2>
      <section className="htb-score-block">
        <strong className="htb-score ht-tabular-numbers">{Math.round(opportunity.opportunityScore)}</strong>
        <div><h3>{view.momentumLabel}</h3><p>{opportunity.whyItMatters}</p></div>
      </section>
      <section className="htb-intel-section htb-intel-section--primary">
        <h3>Decision</h3>
        <dl className="htb-facts">
          <div><dt>Status</dt><dd>{eligible ? "Eligible" : "Monitoring only"}</dd></div>
          <div><dt>Setup</dt><dd>{readable(opportunity.stage)}</dd></div>
          <div><dt>Entry</dt><dd>{framework ? view.positionLabel : "Withheld"}</dd></div>
          <div><dt>Risk</dt><dd className={view.riskLabel === "HIGH" ? "is-negative" : "is-warning"}>{view.riskLabel}</dd></div>
        </dl>
        <p className="htb-risk-copy">{opportunity.riskNote}</p>
      </section>
      <details className="htb-intel-disclosure">
        <summary>Levels and risk</summary>
        <div className="htb-intel-disclosure__body">
          {framework ? (
            <dl className="htb-facts">
              <div><dt>Upside</dt><dd className="ht-tabular-numbers">{formatMarketPrice(framework.uptideMin)}–{formatMarketPrice(framework.uptideMax)}</dd></div>
              <div><dt>Risk zone</dt><dd className="ht-tabular-numbers">{formatMarketPrice(framework.riskZone)}</dd></div>
              <div><dt>Risk / reward</dt><dd className="ht-tabular-numbers">{framework.rr.toFixed(2)}R</dd></div>
            </dl>
          ) : <p>No structured plan available.</p>}
        </div>
      </details>
      <details className="htb-intel-disclosure">
        <summary>Pro X evidence</summary>
        <div className="htb-intel-disclosure__body">
          {prox && prox.status !== "unavailable" ? (
            <><strong>{readable(prox.pulse?.state ?? prox.status)}</strong><p>{prox.event?.headline ?? "Bounded market evidence is attached to the canonical decision."}</p></>
          ) : <p>No fresh Pro X evidence is attached.</p>}
        </div>
      </details>
      <details className="htb-intel-disclosure htb-agent-plan">
        <summary>Agent X</summary>
        <div className="htb-intel-disclosure__body"><HomeTradePlan symbol={opportunity.ticker} compact /></div>
      </details>
      <details className="htb-intel-disclosure htb-evidence">
        <summary>Full evidence</summary>
        <div>
          {visibleEvidence.length > 0 ? <ul>{visibleEvidence.map((signal, index) => <li key={`${signal}-${index}`}>{signal}</li>)}</ul> : <p>No additional evidence is available.</p>}
          <p>{opportunity.whatChanged}</p>
          <p>Engine: {opportunity.engineVersion ?? "canonical"}</p>
        </div>
      </details>
      </div>
    </section>
  );

  return (
    <main className="htb-home ht-home-terminal-surface" aria-label="HT Labs Home">
      <DesktopTerminalFrame
        markets={<HomeTerminalMarkets opportunities={opportunities} watchlist={watchlist} recents={recents} currentSymbol={opportunity.ticker} onSelect={onSelect} />}
        instrumentHeader={instrumentHeader}
        chart={chart}
        intelligence={intelligence}
      />
    </main>
  );
}
