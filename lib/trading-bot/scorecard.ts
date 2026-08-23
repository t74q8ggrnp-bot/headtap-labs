export type BotTradeScorecardRow = {
  id: string;
  ticker: string;
  status: string;
  entry_price: number | null;
  entry_at: string | null;
  exit_price: number | null;
  exit_at: string | null;
  exit_reason: string | null;
  pnl: number | null;
  pnl_percent: number | null;
  bot_score: number | null;
  bot_logic_version: string | null;
  entry_snapshot: Record<string, unknown> | null;
};

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export function getBotEntryPath(trade: BotTradeScorecardRow) {
  if (
    trade.bot_logic_version?.startsWith("orphan-reconciliation") ||
    trade.entry_snapshot?.backfilled === true
  ) {
    return "orphan_reconciliation";
  }
  const explicitPath = trade.entry_snapshot?.botEntryPath;
  if (typeof explicitPath === "string" && explicitPath) return explicitPath;
  return trade.entry_snapshot?.isContinuationEntry === true
    ? "continuation"
    : "standard_or_legacy";
}

export function getBotScoreBucket(score: number | null) {
  if (score === null || !Number.isFinite(score)) return "unscored";
  if (score < 60) return "under_60";
  if (score < 70) return "60_69";
  if (score < 80) return "70_79";
  if (score < 90) return "80_89";
  if (score <= 100) return "90_100";
  return "invalid_over_100_legacy";
}

export function summarizeBotTrades(trades: BotTradeScorecardRow[]) {
  const wins = trades.filter((trade) => Number(trade.pnl) > 0);
  const losses = trades.filter((trade) => Number(trade.pnl) < 0);
  const flat = trades.filter((trade) => Number(trade.pnl) === 0);
  const totalPnl = trades.reduce(
    (sum, trade) => sum + Number(trade.pnl ?? 0),
    0,
  );
  const winningPnl = wins.reduce(
    (sum, trade) => sum + Number(trade.pnl ?? 0),
    0,
  );
  const losingPnl = losses.reduce(
    (sum, trade) => sum + Number(trade.pnl ?? 0),
    0,
  );
  const largestWinner = [...wins].sort(
    (a, b) => Number(b.pnl) - Number(a.pnl),
  )[0];

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    flat: flat.length,
    winRatePercent:
      trades.length > 0 ? round((wins.length / trades.length) * 100) : null,
    totalPnl: round(totalPnl),
    pnlWithoutLargestWinner:
      largestWinner === undefined
        ? round(totalPnl)
        : round(totalPnl - Number(largestWinner.pnl)),
    largestWinner:
      largestWinner === undefined
        ? null
        : {
            ticker: largestWinner.ticker,
            pnl: round(Number(largestWinner.pnl)),
            pnlPercent:
              largestWinner.pnl_percent === null
                ? null
                : round(Number(largestWinner.pnl_percent)),
          },
    averagePnl: trades.length > 0 ? round(totalPnl / trades.length) : null,
    averagePnlPercent:
      trades.length > 0
        ? round(
            trades.reduce(
              (sum, trade) => sum + Number(trade.pnl_percent ?? 0),
              0,
            ) / trades.length,
          )
        : null,
    averageWinPnl:
      wins.length > 0 ? round(winningPnl / wins.length) : null,
    averageLossPnl:
      losses.length > 0 ? round(losingPnl / losses.length) : null,
    profitFactor:
      losingPnl < 0 ? round(winningPnl / Math.abs(losingPnl)) : null,
  };
}

function groupBotTradeSummaries(
  trades: BotTradeScorecardRow[],
  keyForTrade: (trade: BotTradeScorecardRow) => string,
) {
  const groups = new Map<string, BotTradeScorecardRow[]>();
  for (const trade of trades) {
    const key = keyForTrade(trade);
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([key, rows]) => [
      key,
      summarizeBotTrades(rows),
    ]),
  );
}

export function buildBotPerformanceScorecard(
  closedTrades: BotTradeScorecardRow[],
) {
  const realizedTrades = closedTrades.filter(
    (trade) => trade.pnl !== null && trade.exit_price !== null,
  );
  const operationalClosures = closedTrades.filter(
    (trade) => trade.pnl === null || trade.exit_price === null,
  );
  const entryLogicTrades = realizedTrades.filter(
    (trade) => getBotEntryPath(trade) !== "orphan_reconciliation",
  );

  return {
    realizedTrades,
    operationalClosures,
    entryLogicSummary: summarizeBotTrades(entryLogicTrades),
    allRealizedSummary: summarizeBotTrades(realizedTrades),
    byLogicVersion: groupBotTradeSummaries(
      realizedTrades,
      (trade) => trade.bot_logic_version ?? "legacy_unversioned",
    ),
    byEntryPath: groupBotTradeSummaries(realizedTrades, getBotEntryPath),
    byScoreBucket: groupBotTradeSummaries(realizedTrades, (trade) =>
      getBotScoreBucket(trade.bot_score),
    ),
    byExitReason: groupBotTradeSummaries(
      realizedTrades,
      (trade) => trade.exit_reason ?? "unknown",
    ),
    operationalClosuresByReason: Object.fromEntries(
      [
        ...new Set(
          operationalClosures.map(
            (trade) => trade.exit_reason ?? "unknown",
          ),
        ),
      ].map((reason) => [
        reason,
        operationalClosures.filter(
          (trade) => (trade.exit_reason ?? "unknown") === reason,
        ).length,
      ]),
    ),
  };
}
