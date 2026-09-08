import type { CryptoLiveResearchInput, CryptoResearchBook, CryptoResearchCosts, CryptoResearchIdentity } from "./live-research";
// @ts-expect-error Node's strip-types audit runner requires the source extension.
import { cryptoResearchTimestamp, validCryptoResearchCosts } from "./live-research.ts";

export type CryptoHistoricalBook = CryptoResearchBook & {
  identity: CryptoResearchIdentity;
  receivedAt: string;
};

/** Quote-based hypothetical return, NOT a fill-aware backtest or realized P&L. */
export function measureCryptoResearchOutcome({
  input, books, horizonSeconds, costs, measuredAt,
}: {
  input: CryptoLiveResearchInput;
  books: CryptoHistoricalBook[];
  horizonSeconds: 300 | 900 | 1_800 | 3_600;
  costs: CryptoResearchCosts;
  measuredAt: string;
}) {
  const decisionTime = cryptoResearchTimestamp(input.decisionAt);
  const measurementTime = cryptoResearchTimestamp(measuredAt);
  if (!validCryptoResearchCosts(costs) || !Number.isFinite(decisionTime) || !Number.isFinite(measurementTime) ||
      ![300, 900, 1_800, 3_600].includes(horizonSeconds)) throw new Error("Invalid research measurement contract.");
  const target = decisionTime + horizonSeconds * 1_000;
  const base = {
    version: "crypto-research-quote-outcomes-v1" as const,
    method: "hypothetical_ask_to_bid" as const,
    identity: { ...input.identity }, decisionAt: input.decisionAt,
    targetAt: new Date(target).toISOString(), measuredAt,
    costs: { ...costs }, horizonSeconds,
  };
  const entry = input.book;
  const validBook = (book: CryptoResearchBook) => [book.ask, book.bid].every(n => Number.isFinite(n) && n > 0) && book.ask >= book.bid;
  if (!entry || !validBook(entry) || !Number.isFinite(cryptoResearchTimestamp(entry.asOf)) ||
      cryptoResearchTimestamp(entry.asOf) > decisionTime || decisionTime - cryptoResearchTimestamp(entry.asOf) > 15_000) {
    return { ...base, status: "unavailable" as const, reason: "invalid_entry_book", netReturnPercent: null, exitAsOf: null };
  }
  if (measurementTime < target) return { ...base, status: "pending" as const, reason: "not_due", netReturnPercent: null, exitAsOf: null };
  const candidates = books.filter(book =>
    book.identity.provider === input.identity.provider && book.identity.marketId === input.identity.marketId &&
    book.identity.base === input.identity.base && book.identity.quote === input.identity.quote && validBook(book) &&
    cryptoResearchTimestamp(book.asOf) <= target && target - cryptoResearchTimestamp(book.asOf) <= 5_000 &&
    cryptoResearchTimestamp(book.receivedAt) <= measurementTime &&
    cryptoResearchTimestamp(book.receivedAt) >= cryptoResearchTimestamp(book.asOf)
  ).sort((a, b) => cryptoResearchTimestamp(b.asOf) - cryptoResearchTimestamp(a.asOf));
  const exit = candidates[0];
  if (!exit) return { ...base, status: "unavailable" as const, reason: "no_book_at_horizon", netReturnPercent: null, exitAsOf: null };
  if (candidates.some(book => book.asOf === exit.asOf && (book.bid !== exit.bid || book.ask !== exit.ask))) {
    return { ...base, status: "unavailable" as const, reason: "conflicting_horizon_books", netReturnPercent: null, exitAsOf: null };
  }
  const fee = costs.feeBpsPerSide / 10_000, slippage = costs.slippageBpsPerSide / 10_000;
  const entryCost = entry.ask * (1 + slippage) * (1 + fee);
  const exitProceeds = exit.bid * (1 - slippage) * (1 - fee);
  const netReturnPercent = (exitProceeds / entryCost - 1) * 100;
  if (!Number.isFinite(netReturnPercent)) throw new Error("Non-finite research outcome.");
  return { ...base, status: "measured" as const, reason: null, netReturnPercent,
    entryAsOf: entry.asOf, exitAsOf: exit.asOf, entryCost, exitProceeds };
}

export type CryptoEvaluationEpisode = {
  episodeId: string;
  marketId: string;
  modelVersion: string;
  decisionAt: string;
  outcomeAt: string;
  outcomeAvailableAt: string;
  netReturnPercent: number;
};

/** Split already-measured episodes. Never train on test-period or still-unavailable labels. */
export function splitCryptoWalkForward(episodes: CryptoEvaluationEpisode[], boundary: {
  modelVersion: string;
  trainingUntil: string;
  evaluationFrom: string;
  evaluationUntil: string;
  embargoMs: number;
  reportAt: string;
}) {
  const trainEnd = cryptoResearchTimestamp(boundary.trainingUntil);
  const testStart = cryptoResearchTimestamp(boundary.evaluationFrom);
  const testEnd = cryptoResearchTimestamp(boundary.evaluationUntil);
  const report = cryptoResearchTimestamp(boundary.reportAt);
  if (![trainEnd, testStart, testEnd, report].every(Number.isFinite) ||
      !Number.isFinite(boundary.embargoMs) || boundary.embargoMs < 0 || trainEnd + boundary.embargoMs >= testStart ||
      testStart >= testEnd || report < testEnd || !boundary.modelVersion) throw new Error("Invalid walk-forward boundaries.");
  const training: CryptoEvaluationEpisode[] = [], evaluation: CryptoEvaluationEpisode[] = [];
  const excluded: Array<{ episodeId: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const row of [...episodes].sort((a, b) => cryptoResearchTimestamp(a.decisionAt) - cryptoResearchTimestamp(b.decisionAt))) {
    if (!row.episodeId || !row.marketId || seen.has(row.episodeId)) throw new Error("Duplicate or missing evaluation episode identity.");
    seen.add(row.episodeId);
    const decision = cryptoResearchTimestamp(row.decisionAt), outcome = cryptoResearchTimestamp(row.outcomeAt);
    const available = cryptoResearchTimestamp(row.outcomeAvailableAt);
    if (![decision, outcome, available, row.netReturnPercent].every(Number.isFinite) || outcome <= decision || available < outcome) {
      excluded.push({ episodeId: row.episodeId, reason: "invalid_or_unmeasured_episode" });
    } else if (row.modelVersion !== boundary.modelVersion) {
      excluded.push({ episodeId: row.episodeId, reason: "different_model_version" });
    } else if (decision < trainEnd && outcome <= trainEnd && available <= trainEnd) {
      training.push({ ...row });
    } else if (decision >= testStart && decision < testEnd && outcome <= testEnd && available <= report) {
      evaluation.push({ ...row });
    } else {
      excluded.push({ episodeId: row.episodeId, reason: "outside_window_or_unavailable_label" });
    }
  }
  return { modelVersion: boundary.modelVersion, training, evaluation, excluded,
    evaluationSummary: {
      measuredEpisodes: evaluation.length,
      averageNetReturnPercent: evaluation.length ? evaluation.reduce((sum, row) => sum + row.netReturnPercent, 0) / evaluation.length : null,
      positiveReturnRate: evaluation.length ? evaluation.filter(row => row.netReturnPercent > 0).length / evaluation.length : null,
      // This helper provides a split, not model optimization or promotion authority.
      profitableEdgeEstablished: false,
    } };
}
