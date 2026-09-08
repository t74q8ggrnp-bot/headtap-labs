// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getHtAgentMissingOutcomeReason } from "./outcome-policy.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { findProxOutcomeBarAtTarget, type ProxOutcomeBar } from "../prox/shadow-outcome-resolution.ts";

export type HtAgentDueOutcome = {
  id: string;
  targetAt: string;
  symbol: string;
  proposedEntry: number | null;
  cohort: string;
  wouldEnter: boolean;
  conservativeSlippageBps: number;
};

export type HtAgentOutcomePlan =
  | { row: HtAgentDueOutcome; state: "pending"; reason: "provider_failed" | "awaiting_bar" }
  | { row: HtAgentDueOutcome; state: "unavailable"; reason: string }
  | { row: HtAgentDueOutcome; state: "measured"; bar: ProxOutcomeBar; evidenceKey: string };

export type HtAgentOutcomeUpdate = {
  id: string;
  observedAt: string;
  providerTimestamp: string | null;
  quoteProviderTimestamp: string | null;
  bid: number | null;
  ask: number | null;
  spreadPercent: number | null;
  price: number | null;
  returnPercent: number | null;
  resolutionState: "measured" | "unavailable";
  unavailableReason: string | null;
};

export type HtAgentHistoricalNbbo = {
  bid: number | null;
  ask: number | null;
  timestamp: string;
};

export function htAgentOutcomeEvidenceKey(symbol: string, timeMs: number) {
  return `${symbol}|${Math.floor(timeMs)}`;
}

export function planHtAgentOutcomeBatch({
  rows,
  barsBySymbol,
  failedSymbols,
  observedAt,
}: {
  rows: HtAgentDueOutcome[];
  barsBySymbol: Map<string, ProxOutcomeBar[]>;
  failedSymbols: Set<string>;
  observedAt: Date;
}) {
  return rows.map((row): HtAgentOutcomePlan => {
    if (failedSymbols.has(row.symbol)) {
      return { row, state: "pending", reason: "provider_failed" };
    }
    const bar = findProxOutcomeBarAtTarget(barsBySymbol.get(row.symbol) ?? [], row.targetAt);
    if (bar) {
      return {
        row,
        state: "measured",
        bar,
        evidenceKey: htAgentOutcomeEvidenceKey(row.symbol, bar.timeMs),
      };
    }
    const reason = getHtAgentMissingOutcomeReason({ targetAt: row.targetAt, observedAt });
    return reason
      ? { row, state: "unavailable", reason }
      : { row, state: "pending", reason: "awaiting_bar" };
  });
}

export function buildHtAgentOutcomeUpdate(
  plan: Exclude<HtAgentOutcomePlan, { state: "pending" }>,
  observedAt: Date,
  nbbo: HtAgentHistoricalNbbo | null,
): HtAgentOutcomeUpdate {
  if (plan.state === "unavailable") {
    return {
      id: plan.row.id,
      observedAt: observedAt.toISOString(),
      providerTimestamp: null,
      quoteProviderTimestamp: null,
      bid: null,
      ask: null,
      spreadPercent: null,
      price: null,
      returnPercent: null,
      resolutionState: "unavailable",
      unavailableReason: plan.reason,
    };
  }

  const entry = Number(plan.row.proposedEntry ?? 0);
  const rawReturn = entry > 0 ? (plan.bar.close - entry) / entry * 100 : null;
  const returnPercent = rawReturn === null
    ? null
    : plan.row.wouldEnter
      ? rawReturn - Number(plan.row.conservativeSlippageBps ?? 0) / 100
      : rawReturn;
  const validBook = Boolean(
    nbbo?.bid && nbbo.ask && nbbo.ask >= nbbo.bid,
  );
  const midpoint = validBook ? (nbbo!.bid! + nbbo!.ask!) / 2 : null;
  return {
    id: plan.row.id,
    observedAt: observedAt.toISOString(),
    providerTimestamp: new Date(plan.bar.timeMs).toISOString(),
    quoteProviderTimestamp: validBook ? nbbo!.timestamp : null,
    bid: validBook ? nbbo!.bid : null,
    ask: validBook ? nbbo!.ask : null,
    spreadPercent: midpoint ? (nbbo!.ask! - nbbo!.bid!) / midpoint * 100 : null,
    price: plan.bar.close,
    returnPercent,
    resolutionState: "measured",
    unavailableReason: null,
  };
}
