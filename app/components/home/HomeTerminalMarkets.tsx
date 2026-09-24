"use client";

import Link from "next/link";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Opportunity } from "@/lib/opportunity-model";
import { formatMarketPrice } from "@/lib/market-price-format";
import type { HomeOpportunityLane } from "@/lib/market-workspace-route";
import {
  MARKET_CORE_SYMBOLS,
  MARKET_MEGA_CAP_SYMBOLS,
  MARKET_WORKSPACE_SYMBOLS,
  marketWorkspaceAssetLabel,
} from "@/lib/market-workspace-universe";
import TickerSearchCombobox from "@/app/components/trade/TickerSearchCombobox";

type HomeTab = "momentum" | "before-crowd" | "watchlist" | "recent";
type MarketTab = "core" | "mega-cap" | "bullish" | "bearish" | "watchlist" | "recent";
type TerminalTab = HomeTab | MarketTab;
type MarketQuote = { price: number; change: number; rvol: number | null; asOf?: string };

const homeTabs: Array<{ id: HomeTab; label: string }> = [
  { id: "momentum", label: "Spot Momentum" },
  { id: "before-crowd", label: "Before the Crowd" },
  { id: "watchlist", label: "Watchlist" },
  { id: "recent", label: "Recently Viewed" },
];

const marketTabs: Array<{ id: MarketTab; label: string }> = [
  { id: "core", label: "Core Markets" },
  { id: "mega-cap", label: "Mega Caps" },
  { id: "bullish", label: "Bullish Today" },
  { id: "bearish", label: "Bearish Today" },
  { id: "watchlist", label: "Watchlist" },
  { id: "recent", label: "Recently Viewed" },
];

const descriptions: Record<TerminalTab, string> = {
  momentum: "Canonical opportunities showing verified momentum now.",
  "before-crowd": "Canonical early-interest candidates that have not graduated into momentum.",
  core: "Broad-market ETFs from the shared live market frame.",
  "mega-cap": "Frequently followed large-cap stocks with verified market snapshots.",
  bullish: "Major symbols trading higher today. Direction only — not a recommendation.",
  bearish: "Major symbols trading lower today. Direction only — not a recommendation.",
  watchlist: "Symbols saved to your HT Labs watchlist.",
  recent: "Symbols opened recently on this device.",
};

const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function HomeTerminalMarkets({
  mode = "home",
  spotMomentum,
  beforeCrowd,
  watchlist,
  recents,
  currentSymbol,
  onSelect,
  onNavigate,
  searchEnabled = false,
  marketQuotes = {},
}: {
  mode?: "home" | "market";
  spotMomentum: Opportunity[];
  beforeCrowd: Opportunity[];
  watchlist: string[];
  recents: string[];
  currentSymbol: string;
  onSelect: (opportunity: Opportunity, lane: HomeOpportunityLane) => void;
  onNavigate?: () => void;
  searchEnabled?: boolean;
  marketQuotes?: Record<string, MarketQuote>;
}) {
  const tabs: Array<{ id: TerminalTab; label: string }> = mode === "market" ? marketTabs : homeTabs;
  const [tab, setTab] = useState<TerminalTab>(mode === "market" ? "core" : "momentum");
  const prefix = useId().replaceAll(":", "");
  const bySymbol = useMemo(
    () => new Map(
      [...spotMomentum, ...beforeCrowd].map((opportunity) => [opportunity.ticker, opportunity]),
    ),
    [beforeCrowd, spotMomentum],
  );
  const rows = useMemo(() => {
    if (tab === "momentum") return spotMomentum.slice(0, 15).map((opportunity) => ({ symbol: opportunity.ticker, opportunity, lane: "spot_momentum" as const, quote: null, assetLabel: "Canonical" }));
    if (tab === "before-crowd") return beforeCrowd.slice(0, 15).map((opportunity) => ({ symbol: opportunity.ticker, opportunity, lane: "before_the_crowd" as const, quote: null, assetLabel: "Canonical" }));
    if (tab === "core" || tab === "mega-cap" || tab === "bullish" || tab === "bearish") {
      const baseSymbols = tab === "core"
        ? [...MARKET_CORE_SYMBOLS]
        : tab === "mega-cap"
          ? [...MARKET_MEGA_CAP_SYMBOLS]
          : [...MARKET_WORKSPACE_SYMBOLS]
            .filter((symbol) => tab === "bullish" ? (marketQuotes[symbol]?.change ?? 0) > 0 : (marketQuotes[symbol]?.change ?? 0) < 0)
            .sort((left, right) => tab === "bullish"
              ? (marketQuotes[right]?.change ?? 0) - (marketQuotes[left]?.change ?? 0)
              : (marketQuotes[left]?.change ?? 0) - (marketQuotes[right]?.change ?? 0));
      return baseSymbols.map((symbol) => ({
        symbol,
        opportunity: null,
        lane: "spot_momentum" as const,
        quote: marketQuotes[symbol] ?? null,
        assetLabel: marketWorkspaceAssetLabel(symbol),
      }));
    }
    const symbols = tab === "watchlist" ? watchlist : recents;
    return symbols.slice(0, 15).map((symbol) => {
      const opportunity = bySymbol.get(symbol) ?? null;
      return {
        symbol,
        opportunity,
        quote: mode === "market" ? marketQuotes[symbol] ?? null : null,
        assetLabel: mode === "market"
          ? (MARKET_WORKSPACE_SYMBOLS as readonly string[]).includes(symbol)
            ? marketWorkspaceAssetLabel(symbol)
            : "—"
          : "Canonical",
        lane: opportunity?.strategy === "before_the_crowd" ? "before_the_crowd" as const : "spot_momentum" as const,
      };
    });
  }, [beforeCrowd, bySymbol, marketQuotes, mode, recents, spotMomentum, tab, watchlist]);

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: TerminalTab) => {
    const index = tabs.findIndex((candidate) => candidate.id === current);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id);
    document.getElementById(`${prefix}-market-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div className="htb-opportunities ht-terminal-markets" data-market-mode={mode}>
      {searchEnabled ? (
        <div className="ht-terminal-market-search">
          <TickerSearchCombobox currentSymbol={currentSymbol} compact destination="market" />
        </div>
      ) : null}
      <div className="ht-terminal-market-tabs" role="tablist" aria-label="Market lists">
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            id={`${prefix}-market-tab-${candidate.id}`}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            aria-controls={`${prefix}-market-panel`}
            tabIndex={tab === candidate.id ? 0 : -1}
            onClick={() => setTab(candidate.id)}
            onKeyDown={(event) => moveTab(event, candidate.id)}
          >
            <span>{candidate.label}</span>
            <small className="ht-tabular-numbers">
              {candidate.id === "momentum"
                ? spotMomentum.length
                : candidate.id === "before-crowd"
                  ? beforeCrowd.length
                  : candidate.id === "core"
                    ? MARKET_CORE_SYMBOLS.length
                    : candidate.id === "mega-cap"
                      ? MARKET_MEGA_CAP_SYMBOLS.length
                      : candidate.id === "bullish"
                        ? MARKET_WORKSPACE_SYMBOLS.filter((symbol) => (marketQuotes[symbol]?.change ?? 0) > 0).length
                        : candidate.id === "bearish"
                          ? MARKET_WORKSPACE_SYMBOLS.filter((symbol) => (marketQuotes[symbol]?.change ?? 0) < 0).length
                  : candidate.id === "watchlist"
                    ? watchlist.length
                    : recents.length}
            </small>
          </button>
        ))}
      </div>
      <div id={`${prefix}-market-panel`} role="tabpanel" aria-labelledby={`${prefix}-market-tab-${tab}`}>
        <p className="ht-terminal-market-description">{descriptions[tab]}</p>
        {rows.length > 0 ? (
          <table className="ht-terminal-market-table">
            <colgroup>
              <col className="ht-terminal-market-col--symbol" />
              <col className="ht-terminal-market-col--last" />
              <col className="ht-terminal-market-col--change" />
              <col className="ht-terminal-market-col--rvol" />
              <col className="ht-terminal-market-col--score" />
            </colgroup>
            <thead>
              <tr><th>Symbol</th><th>Last</th><th>Chg</th><th>RVOL</th><th>{mode === "market" ? "Type" : "HT"}</th></tr>
            </thead>
            <tbody>
              {rows.map(({ symbol, opportunity, lane, quote, assetLabel }) => {
                const active = symbol === currentSymbol;
                return (
                  <tr key={`${tab}-${symbol}`} data-active={active ? "true" : "false"}>
                    <th scope="row">
                      {opportunity ? (
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            onSelect(opportunity, lane);
                            onNavigate?.();
                          }}
                        >
                          {symbol}
                        </button>
                      ) : (
                        <Link href={`/market?ticker=${encodeURIComponent(symbol)}`} onClick={onNavigate}>{symbol}</Link>
                      )}
                    </th>
                    <td>{opportunity ? formatMarketPrice(opportunity.price) : quote ? formatMarketPrice(quote.price) : "—"}</td>
                    <td className={opportunity ? opportunity.change >= 0 ? "is-positive" : "is-negative" : quote ? quote.change >= 0 ? "is-positive" : "is-negative" : undefined}>{opportunity ? percent(opportunity.change) : quote ? percent(quote.change) : "—"}</td>
                    <td>{opportunity?.relativeVolume != null && opportunity.relativeVolume > 0 ? `${opportunity.relativeVolume.toFixed(1)}x` : quote?.rvol != null ? `${quote.rvol.toFixed(1)}x` : "—"}</td>
                    <td>{mode === "market" ? assetLabel : opportunity ? Math.round(opportunity.opportunityScore) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="ht-terminal-market-empty" role="status">
            {tab === "watchlist"
              ? "No saved symbols yet. Add a symbol with Watch from Home or Workspace."
              : tab === "recent"
                ? "No recently viewed symbols on this device."
                : tab === "before-crowd"
                  ? "No eligible Before the Crowd candidates right now."
                  : tab === "bullish"
                    ? "No major symbol in the shared market frame is trading higher right now."
                    : tab === "bearish"
                      ? "No major symbol in the shared market frame is trading lower right now."
                  : "No eligible Spot Momentum opportunities right now."}
          </p>
        )}
      </div>
      {mode === "home" ? (
        <Link href="/scanner" className="ht-terminal-market-footer" onClick={onNavigate}>Open full scanner <span aria-hidden="true">→</span></Link>
      ) : (
        <p className="ht-terminal-market-footer">Search any listed stock or ETF above</p>
      )}
    </div>
  );
}
