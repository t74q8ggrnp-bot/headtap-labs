"use client";

import Link from "next/link";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Opportunity } from "@/lib/opportunity-model";
import { formatMarketPrice } from "@/lib/market-price-format";

type MarketTab = "opportunities" | "watchlist" | "recent";

const tabs: Array<{ id: MarketTab; label: string }> = [
  { id: "opportunities", label: "Opportunities" },
  { id: "watchlist", label: "Watchlist" },
  { id: "recent", label: "Recent" },
];

const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function HomeTerminalMarkets({
  opportunities,
  watchlist,
  recents,
  currentSymbol,
  onSelect,
}: {
  opportunities: Opportunity[];
  watchlist: string[];
  recents: string[];
  currentSymbol: string;
  onSelect: (opportunity: Opportunity) => void;
}) {
  const [tab, setTab] = useState<MarketTab>("opportunities");
  const prefix = useId().replaceAll(":", "");
  const bySymbol = useMemo(
    () => new Map(opportunities.map((opportunity) => [opportunity.ticker, opportunity])),
    [opportunities],
  );
  const rows = useMemo(() => {
    if (tab === "opportunities") return opportunities.slice(0, 12).map((opportunity) => ({ symbol: opportunity.ticker, opportunity }));
    const symbols = tab === "watchlist" ? watchlist : recents;
    return symbols.slice(0, 15).map((symbol) => ({ symbol, opportunity: bySymbol.get(symbol) ?? null }));
  }, [bySymbol, opportunities, recents, tab, watchlist]);

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: MarketTab) => {
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
    <div className="htb-opportunities ht-terminal-markets">
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
            {candidate.label}
          </button>
        ))}
      </div>
      <div id={`${prefix}-market-panel`} role="tabpanel" aria-labelledby={`${prefix}-market-tab-${tab}`}>
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
              <tr><th>Symbol</th><th>Last</th><th>Chg</th><th>RVOL</th><th>HT</th></tr>
            </thead>
            <tbody>
              {rows.map(({ symbol, opportunity }) => {
                const active = symbol === currentSymbol;
                return (
                  <tr key={`${tab}-${symbol}`} data-active={active ? "true" : "false"}>
                    <th scope="row">
                      {opportunity ? (
                        <button type="button" aria-pressed={active} onClick={() => onSelect(opportunity)}>{symbol}</button>
                      ) : (
                        <Link href={`/trade/${encodeURIComponent(symbol)}`}>{symbol}</Link>
                      )}
                    </th>
                    <td>{opportunity ? formatMarketPrice(opportunity.price) : "—"}</td>
                    <td className={opportunity ? opportunity.change >= 0 ? "is-positive" : "is-negative" : undefined}>{opportunity ? percent(opportunity.change) : "—"}</td>
                    <td>{opportunity?.relativeVolume != null && opportunity.relativeVolume > 0 ? `${opportunity.relativeVolume.toFixed(1)}x` : "—"}</td>
                    <td>{opportunity ? Math.round(opportunity.opportunityScore) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="ht-terminal-market-empty" role="status">
            {tab === "watchlist" ? "No saved symbols yet." : tab === "recent" ? "No recently viewed symbols on this device." : "No eligible Canonical opportunities."}
          </p>
        )}
      </div>
      <Link href="/scanner" className="ht-terminal-market-footer">Open full scanner <span aria-hidden="true">→</span></Link>
    </div>
  );
}
