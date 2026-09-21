"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import HomeTradePlan from "@/app/components/agent/HomeTradePlan";
import DesktopTerminalFrame from "@/app/components/terminal/DesktopTerminalFrame";
import { AccessibleDialogSheet } from "@/app/components/ui/ApplicationPrimitives";
import type { TradeFrameworkDisplay } from "@/lib/contracts/market";
import { getSafeAccountIdentity, type HomeAlert } from "@/lib/home-account";
import { formatMarketPrice } from "@/lib/market-price-format";
import { getOpportunityPresentation, type Opportunity } from "@/lib/opportunity-model";
import { HomeAccountSurface, HomeAlertsSurface } from "./HomeAccountAlerts";
import HomeReferenceChart from "./HomeReferenceChart";
import HomeTerminalMarkets from "./HomeTerminalMarkets";
import { useLiveMarketView } from "@/app/hooks/useLiveMarketView";

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
  symbol: string;
  opportunity: Opportunity | null;
  spotMomentum: Opportunity[];
  beforeCrowd: Opportunity[];
  framework: TradeFrameworkDisplay | null;
  marketContext: HomeMarketContext | null;
  watchlist: string[];
  recents: string[];
  watched: boolean;
  watchlistBusy: boolean;
  selectionLoading: boolean;
  selectionError: string;
  authDestination: "signin" | "profile" | null;
  authReady: boolean;
  session: Session | null;
  authEmail: string;
  authPassword: string;
  authLoading: boolean;
  authMessage: string;
  watchlistCloudEnabled: boolean;
  watchlistSyncState: "loading" | "local" | "syncing" | "synced" | "error";
  watchlistSyncError: string | null;
  savedSetupCount: number;
  signalMemoryInsight: { tracked: number; successRate: number | null } | null;
  alerts: HomeAlert[];
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthenticate: (mode: "signin" | "signup") => void;
  onSignOut: () => void;
  onSelectAlert: (alert: HomeAlert) => void;
  onSelect: (opportunity: Opportunity) => void;
  onToggleWatchlist: () => void;
};

const changeLabel = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const readable = (value: string | null | undefined) => value ? value.replaceAll("_", " ") : "Unavailable";

function providerTime(timestamp: string | null | undefined) {
  if (!timestamp) return "Provider time pending";
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "Provider time pending";
  return `Provider ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  }).format(parsed)}`;
}

export default function HomeReferenceSurface({
  symbol,
  opportunity,
  spotMomentum,
  beforeCrowd,
  framework,
  marketContext,
  watchlist,
  recents,
  watched,
  watchlistBusy,
  selectionLoading,
  selectionError,
  authDestination,
  authReady,
  session,
  authEmail,
  authPassword,
  authLoading,
  authMessage,
  watchlistCloudEnabled,
  watchlistSyncState,
  watchlistSyncError,
  savedSetupCount,
  signalMemoryInsight,
  alerts,
  onAuthEmailChange,
  onAuthPasswordChange,
  onAuthenticate,
  onSignOut,
  onSelectAlert,
  onSelect,
  onToggleWatchlist,
}: Props) {
  const [compactLayout, setCompactLayout] = useState<"pending" | "compact" | "desktop">("pending");
  const [compactIntelligenceOpen, setCompactIntelligenceOpen] = useState(false);
  const [marketBrowserOpen, setMarketBrowserOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const accountDestinationHandled = useRef<string | null>(null);
  const marketView = useLiveMarketView(symbol);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1179px)");
    const apply = () => {
      const next = query.matches ? "compact" : "desktop";
      setCompactLayout(next);
      if (next === "desktop") setCompactIntelligenceOpen(false);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!authDestination || accountDestinationHandled.current === authDestination) return;
    accountDestinationHandled.current = authDestination;
    setAccountOpen(true);
  }, [authDestination]);

  useEffect(() => {
    const openAccount = () => setAccountOpen(true);
    const openAlerts = () => setAlertsOpen(true);
    const openMarkets = () => setMarketBrowserOpen(true);
    window.addEventListener("htlabs:open-account", openAccount);
    window.addEventListener("htlabs:open-alerts", openAlerts);
    window.addEventListener("htlabs:open-markets", openMarkets);
    return () => {
      window.removeEventListener("htlabs:open-account", openAccount);
      window.removeEventListener("htlabs:open-alerts", openAlerts);
      window.removeEventListener("htlabs:open-markets", openMarkets);
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("markets") !== "open") return;
    const openTimer = window.setTimeout(() => setMarketBrowserOpen(true), 0);
    window.history.replaceState(window.history.state, "", "/market");
    return () => window.clearTimeout(openTimer);
  }, []);

  const unreadAlertCount = alerts.filter((alert) => !alert.read).length;
  const accountIdentity = getSafeAccountIdentity(session?.user.email);
  const accountAndAlerts = (
    <>
      <HomeAccountSurface
        open={accountOpen}
        onOpenChange={setAccountOpen}
        authReady={authReady}
        session={session}
        email={authEmail}
        password={authPassword}
        authLoading={authLoading}
        authMessage={authMessage}
        cloudEnabled={watchlistCloudEnabled}
        syncState={watchlistSyncState}
        syncError={watchlistSyncError}
        watchlistCount={watchlist.length}
        savedSetupCount={savedSetupCount}
        signalMemory={signalMemoryInsight}
        unreadAlertCount={unreadAlertCount}
        onEmailChange={onAuthEmailChange}
        onPasswordChange={onAuthPasswordChange}
        onAuthenticate={onAuthenticate}
        onSignOut={onSignOut}
        onOpenAlerts={() => {
          setAccountOpen(false);
          window.requestAnimationFrame(() => setAlertsOpen(true));
        }}
      />
      <HomeAlertsSurface
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        alerts={alerts}
        onSelect={(alert) => {
          onSelectAlert(alert);
          setAlertsOpen(false);
        }}
      />
    </>
  );

  const canonicalOpportunity = opportunity?.ticker === symbol ? opportunity : null;
  const view = canonicalOpportunity
    ? getOpportunityPresentation(canonicalOpportunity)
    : null;
  const eligible = canonicalOpportunity?.eligibility?.eligible === true;
  const prox = canonicalOpportunity?.proxIntelligence;
  const visibleEvidence = canonicalOpportunity?.signals.slice(0, 5) ?? [];
  const displayPrice = marketView.quote?.price ?? canonicalOpportunity?.price ?? null;
  const displayChange = marketView.quote?.changePercent ?? canonicalOpportunity?.change ?? null;
  const providerTimestamp = marketView.quote?.asOf ??
    canonicalOpportunity?.displayQuoteAsOf ?? canonicalOpportunity?.scannedAt ?? null;
  const providerLabel = providerTimestamp
    ? providerTime(providerTimestamp)
    : "Provider time pending";

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
            <h1 id="htb-symbol-title">{symbol}</h1>
            <strong className="ht-tabular-numbers">{displayPrice === null ? "—" : formatMarketPrice(displayPrice)}</strong>
            {displayChange === null ? null : (
              <span className={`ht-tabular-numbers ${displayChange >= 0 ? "is-positive" : "is-negative"}`}>{changeLabel(displayChange)}</span>
            )}
          </div>
          <p>{canonicalOpportunity ? readable(canonicalOpportunity.scanSession) : marketView.label} · {providerLabel}</p>
        </div>
        <div className="ht-terminal-home-actions">
          <button
            type="button"
            className="ht-home-compact-action ht-home-markets-launcher"
            aria-label="Explore Spot Momentum, Before the Crowd, Watchlist, and Recently Viewed"
            aria-haspopup="dialog"
            aria-expanded={marketBrowserOpen}
            onClick={() => setMarketBrowserOpen(true)}
          >
            <span aria-hidden="true">▦</span>
            <span>Markets</span>
          </button>
          <button
            type="button"
            className="ht-home-compact-action ht-home-intelligence-launcher"
            aria-label="Open HT Intelligence"
            aria-haspopup="dialog"
            aria-expanded={compactIntelligenceOpen}
            onClick={() => setCompactIntelligenceOpen(true)}
          >
            <span aria-hidden="true">HT</span>
            <span>Intel</span>
          </button>
          <button
            type="button"
            className="ht-terminal-action"
            aria-label={watched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
            aria-pressed={watched}
            disabled={watchlistBusy}
            onClick={onToggleWatchlist}
          >
            <span className="ht-home-action-icon" aria-hidden="true">{watched ? "★" : "☆"}</span>
            <span className="ht-home-action-label ht-home-action-label--mobile">{watched ? "Saved" : "Watch"}</span>
            <span className="ht-home-action-label ht-home-action-label--desktop">{watched ? "Watching" : "Watch"}</span>
          </button>
          <Link
            href={`/paper?symbol=${encodeURIComponent(symbol)}`}
            className="htb-workspace-link"
            aria-label={`Review ${symbol} in Paper Trading`}
          >
            <span className="ht-home-action-icon" aria-hidden="true">↗</span>
            <span className="ht-home-action-label ht-home-action-label--mobile">Paper</span>
            <span className="ht-home-action-label ht-home-action-label--desktop">Review in Paper</span>
          </Link>
        </div>
      </header>
    </>
  );

  const chart = (
    <>
      <div className="htb-decision-line" data-home-priority="2-decision">
        {canonicalOpportunity ? (
          <>
            <strong>{readable(canonicalOpportunity.opportunityType)} · {Math.round(canonicalOpportunity.opportunityScore)}</strong>
            <span>{canonicalOpportunity.whatChanged || canonicalOpportunity.whyItMatters}</span>
          </>
        ) : (
          <>
            <strong>{symbol}</strong>
            <span>No current Canonical decision exists for {symbol}. The chart remains provider-backed.</span>
          </>
        )}
      </div>
      {selectionLoading ? <div className="htb-selection-state" role="status">Loading {symbol} Canonical context…</div> : null}
      {selectionError ? <div className="htb-selection-state htb-selection-state--error" role="status">{selectionError}</div> : null}
      <div data-home-priority="3-chart"><HomeReferenceChart symbol={symbol} /></div>
      <button
        type="button"
        className="ht-home-discovery-strip"
        aria-label={`Explore ${spotMomentum.length} Spot Momentum opportunities, ${beforeCrowd.length} Before the Crowd opportunities, Watchlist, and Recently Viewed`}
        onClick={() => setMarketBrowserOpen(true)}
      >
        <span><strong>Spot {spotMomentum.length}</strong><strong>Early {beforeCrowd.length}</strong><span>Watchlist</span></span>
        <span aria-hidden="true">Explore →</span>
      </button>
    </>
  );

  const intelligence = compactLayout === "pending" ? null : (
    <section
      className="htb-intelligence-shell"
      data-home-priority="4-intelligence"
    >
      <div className="htb-intelligence">
      <h2 className="sr-only">HT Intelligence</h2>
      <section className="htb-score-block">
        <strong className="htb-score ht-tabular-numbers">{canonicalOpportunity ? Math.round(canonicalOpportunity.opportunityScore) : "—"}</strong>
        <div>
          <h3>{view?.momentumLabel ?? "No current Canonical decision"}</h3>
          <p>{canonicalOpportunity?.whyItMatters ?? `${symbol} is available as a universal provider-backed chart, but it is not in the current Canonical opportunity frame.`}</p>
        </div>
      </section>
      <section className="htb-intel-section htb-intel-section--primary">
        <h3>Decision</h3>
        <dl className="htb-facts">
          <div><dt>Status</dt><dd>{canonicalOpportunity ? eligible ? "Eligible" : "Monitoring only" : "Unavailable"}</dd></div>
          <div><dt>Setup</dt><dd>{canonicalOpportunity ? readable(canonicalOpportunity.stage) : "No current setup"}</dd></div>
          <div><dt>Entry</dt><dd>{framework && view ? view.positionLabel : "Withheld"}</dd></div>
          <div><dt>Risk</dt><dd className={view?.riskLabel === "HIGH" ? "is-negative" : "is-warning"}>{view?.riskLabel ?? "Unmeasured"}</dd></div>
        </dl>
        <p className="htb-risk-copy">{canonicalOpportunity?.riskNote ?? `HT Labs will not fabricate a score, setup, entry, or risk level for ${symbol}.`}</p>
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
        <div className="htb-intel-disclosure__body"><HomeTradePlan symbol={symbol} compact /></div>
      </details>
      <details className="htb-intel-disclosure htb-evidence">
        <summary>Full evidence</summary>
        <div>
          {visibleEvidence.length > 0 ? <ul>{visibleEvidence.map((signal, index) => <li key={`${signal}-${index}`}>{signal}</li>)}</ul> : <p>No additional evidence is available.</p>}
          <p>{canonicalOpportunity?.whatChanged ?? `No current Canonical evidence is attached to ${symbol}.`}</p>
          <p>Engine: {canonicalOpportunity?.engineVersion ?? "No current decision"}</p>
        </div>
      </details>
      </div>
    </section>
  );

  return (
    <main
      className="htb-home ht-home-terminal-surface"
      aria-label="HT Labs Market workspace"
      data-workspace-symbol={symbol}
    >
      <DesktopTerminalFrame
        navigationUtilities={(
          <>
            <button
              type="button"
              className="ht-terminal-nav__utility"
              aria-label={unreadAlertCount > 0 ? `Open HT Alerts, ${unreadAlertCount} unread` : "Open HT Alerts"}
              data-label="HT Alerts"
              onClick={() => setAlertsOpen(true)}
            >
              <span aria-hidden="true">◌</span>
              {unreadAlertCount > 0 ? <strong aria-hidden="true">{unreadAlertCount > 9 ? "9+" : unreadAlertCount}</strong> : null}
            </button>
            <button
              type="button"
              className="ht-terminal-nav__utility ht-terminal-nav__account"
              aria-label={!authReady ? "Checking HT Labs account session" : session ? `Open account for ${accountIdentity.shortEmail}` : "Sign in to HT Labs"}
              data-label={!authReady ? "Checking account" : session ? accountIdentity.shortEmail : "Sign in"}
              onClick={() => setAccountOpen(true)}
            >
              {!authReady ? <span aria-hidden="true">…</span> : session ? accountIdentity.initials : <span aria-hidden="true">↪</span>}
            </button>
          </>
        )}
        markets={(
          <HomeTerminalMarkets
            spotMomentum={spotMomentum}
            beforeCrowd={beforeCrowd}
            watchlist={watchlist}
            recents={recents}
            currentSymbol={symbol}
            onSelect={onSelect}
          />
        )}
        instrumentHeader={instrumentHeader}
        chart={chart}
        intelligence={compactLayout === "desktop" ? intelligence : null}
      />
      <AccessibleDialogSheet
        open={marketBrowserOpen}
        onOpenChange={setMarketBrowserOpen}
        title="Explore markets"
        description="Browse real Canonical opportunity lanes and your personal market lists."
        presentation="sheet"
        className="ht-home-market-browser"
      >
        <HomeTerminalMarkets
          spotMomentum={spotMomentum}
          beforeCrowd={beforeCrowd}
          watchlist={watchlist}
          recents={recents}
          currentSymbol={symbol}
          onSelect={onSelect}
          onNavigate={() => setMarketBrowserOpen(false)}
        />
      </AccessibleDialogSheet>
      <AccessibleDialogSheet
        open={compactLayout === "compact" && compactIntelligenceOpen}
        onOpenChange={setCompactIntelligenceOpen}
        title="HT Intelligence"
        description={`${symbol} Canonical decision context, levels, Pro X evidence, and Agent X.`}
        presentation="sheet"
        className="ht-home-intelligence-dialog"
      >
        {compactLayout === "compact" && compactIntelligenceOpen ? intelligence : null}
      </AccessibleDialogSheet>
      {accountAndAlerts}
    </main>
  );
}
