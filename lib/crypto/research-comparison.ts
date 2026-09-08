import type { CryptoHistoricalBook } from "./live-research-evaluation";
import type { CryptoResearchCosts, CryptoResearchIdentity } from "./live-research";
// @ts-expect-error Node source imports.
import { cryptoResearchTimestamp, validCryptoResearchCosts } from "./live-research.ts";
// @ts-expect-error Node source imports.
import { isVerifiedCryptoOutcomeSource } from "./outcome-integrity.ts";

export type SizedResearchBook = CryptoHistoricalBook & { bidSize: number | null; askSize: number | null };
export type CryptoSimulationPolicy = CryptoResearchCosts & {
  executionDelayMs: number;
  maxBookParticipation: number;
};
export type FrozenCryptoChoice = { version: string; frozenAt: string; evidenceHash: string;
  action: "paper_entry" | "no_trade" | "unavailable"; quantity: number | null };
export type MatchedCryptoEpisode = {
  episodeId: string;
  sourceVersion: string;
  identity: CryptoResearchIdentity;
  evidenceHash: string;
  decisionAt: string;
  horizonSeconds: 300 | 900 | 1800 | 3600;
  // Explicit integrity evidence, never inferred from a positive price.
  marketIntegrity: "verified_normal" | "halted" | "suspect" | "unavailable";
  allocatedDollars: number;
  baseline: FrozenCryptoChoice;
  candidate: FrozenCryptoChoice;
  books: SizedResearchBook[];
};

const time = cryptoResearchTimestamp;
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const hash = (s: string) => /^[a-f0-9]{64}$/.test(s);
function assertSimulationPolicy(policy: CryptoSimulationPolicy) {
  if (!validCryptoResearchCosts(policy) || !Number.isFinite(policy.executionDelayMs) || policy.executionDelayMs < 0 ||
      policy.executionDelayMs > 60_000 || !positive(policy.maxBookParticipation) || policy.maxBookParticipation > 1) {
    throw new Error("Explicit bounded simulation costs/delay/liquidity assumptions are required.");
  }
}

/** Top-of-book conservative paper simulation; no order routing or fitted defaults.
 * Insufficient size is unfilled, not an optimistic full/partial fill. */
export function simulateCryptoResearchChoice(episode: MatchedCryptoEpisode, choice: FrozenCryptoChoice,
  policy: CryptoSimulationPolicy, measuredAt: string) {
  const empty = (status: "unavailable" | "unfilled", reason: string) => ({ status, reason,
    pnlDollars: null, netReturnPercent: null, entryAsOf: null, exitAsOf: null, observedPnlPath: [] as number[] });
  assertSimulationPolicy(policy);
  if (!isVerifiedCryptoOutcomeSource(episode.sourceVersion)) return empty("unavailable","quarantined_or_unknown_source");
  if (!hash(episode.evidenceHash) || choice.evidenceHash !== episode.evidenceHash) return empty("unavailable","evidence_mismatch");
  const market = /^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_([A-Z0-9.-]+)_USD$/.exec(episode.identity.marketId);
  if (!market || episode.identity.provider !== "coinapi" || episode.identity.quote !== "USD" ||
      episode.identity.base !== market[2]) return empty("unavailable","invalid_market_identity");
  const start = time(episode.decisionAt), report = time(measuredAt);
  if (!Number.isFinite(start) || !Number.isFinite(report) || start > report ||
      ![300,900,1800,3600].includes(episode.horizonSeconds)) return empty("unavailable","invalid_episode_clock");
  if (!positive(episode.allocatedDollars)) return empty("unavailable","invalid_allocation");
  if (choice.action === "unavailable") return empty("unavailable","decision_unavailable");
  if (choice.action === "no_trade") return { status: "no_trade" as const, reason: null, pnlDollars: 0,
    netReturnPercent: 0, entryAsOf: null, exitAsOf: null, observedPnlPath: [0] };
  if (choice.action !== "paper_entry" || !positive(choice.quantity) || !positive(episode.allocatedDollars)) return empty("unavailable","invalid_proposal");
  if (episode.marketIntegrity !== "verified_normal") return empty("unavailable","market_integrity_unverified_or_blocked");
  const entryAfter = start + policy.executionDelayMs;
  const exitAfter = start + episode.horizonSeconds * 1000 + policy.executionDelayMs;
  if (report < exitAfter + 5_000) return empty("unavailable","outcome_not_mature");
  const valid = episode.books.filter(b => b.identity.provider === episode.identity.provider &&
    b.identity.marketId === episode.identity.marketId && b.identity.base === episode.identity.base &&
    b.identity.quote === episode.identity.quote && positive(b.bid) && positive(b.ask) && b.ask >= b.bid &&
    Number.isFinite(time(b.asOf)) && time(b.receivedAt) >= time(b.asOf) && time(b.receivedAt) <= report)
    .sort((a,b) => time(a.asOf) - time(b.asOf));
  const pick = (after: number) => valid.find(b => time(b.asOf) >= after && time(b.asOf) <= after + 5_000 &&
    time(b.receivedAt) <= after + 5_000);
  const entry = pick(entryAfter), exit = pick(exitAfter);
  if (!entry || !exit) return empty("unavailable","no_executable_book_after_delay");
  if ([entry,exit].some(selected => valid.some(b => time(b.asOf) === time(selected.asOf) &&
      (b.bid !== selected.bid || b.ask !== selected.ask || b.bidSize !== selected.bidSize || b.askSize !== selected.askSize)))) {
    return empty("unavailable","conflicting_execution_books");
  }
  const path = valid.filter(b => time(b.asOf) >= time(entry.asOf) && time(b.asOf) <= time(exit.asOf));
  if (path.some((b,index) => index > 0 && b.asOf === path[index - 1].asOf &&
      (b.bid !== path[index - 1].bid || b.ask !== path[index - 1].ask))) return empty("unavailable","conflicting_path_books");
  if (!positive(entry.askSize) || !positive(exit.bidSize)) return empty("unavailable","missing_book_liquidity");
  if (choice.quantity > Math.min(entry.askSize,exit.bidSize) * policy.maxBookParticipation) return empty("unfilled","insufficient_observed_liquidity");
  const fee = policy.feeBpsPerSide / 10_000, slip = policy.slippageBpsPerSide / 10_000;
  const entryCost = entry.ask * (1 + slip) * (1 + fee) * choice.quantity;
  if (entryCost > episode.allocatedDollars) return empty("unfilled","allocation_exceeded");
  const quantity = choice.quantity;
  const liquidation = (bid: number) => bid * (1 - slip) * (1 - fee) * quantity - entryCost;
  const pnlDollars = liquidation(exit.bid);
  return { status: "filled" as const, reason: null, pnlDollars, netReturnPercent: pnlDollars / entryCost * 100,
    entryAsOf: entry.asOf, exitAsOf: exit.asOf,
    observedPnlPath: path.map(b => liquidation(b.bid)) };
}

/** Compare frozen choices on identical evidence. No fitting/optimization occurs.
 * Unmatched/unavailable pairs stay in the denominator report, not a win rate. */
export function compareFrozenCryptoModels(episodes: MatchedCryptoEpisode[], policy: CryptoSimulationPolicy, window: {
  baselineVersion: string; candidateVersion: string; trainingUntil: string;
  evaluationFrom: string; evaluationUntil: string; reportAt: string; embargoMs: number;
  startingCapitalDollars: number;
}) {
  assertSimulationPolicy(policy);
  const train = time(window.trainingUntil), from = time(window.evaluationFrom), until = time(window.evaluationUntil), report = time(window.reportAt);
  if (![train,from,until,report,window.embargoMs].every(Number.isFinite) || window.embargoMs < 0 || train + window.embargoMs >= from ||
      from >= until || until > report || !positive(window.startingCapitalDollars) ||
      !window.baselineVersion || !window.candidateVersion || window.baselineVersion === window.candidateVersion) throw new Error("Invalid frozen walk-forward comparison window.");
  const seen = new Set<string>(), identities = new Set<string>();
  const excluded: Array<{ episodeId: string; reason: string }> = [];
  const paired: Array<{ episodeId: string; marketId: string; decisionAt: string;
    baseline: ReturnType<typeof simulateCryptoResearchChoice>; candidate: ReturnType<typeof simulateCryptoResearchChoice> }> = [];
  let previousEnd = -Infinity;
  let baselineCapital = window.startingCapitalDollars, candidateCapital = window.startingCapitalDollars;
  for (const episode of [...episodes].sort((a,b) => time(a.decisionAt) - time(b.decisionAt))) {
    const identity = `${episode.identity.marketId}|${episode.decisionAt}|${episode.horizonSeconds}`;
    if (seen.has(episode.episodeId) || identities.has(identity)) throw new Error("Duplicate comparison episode.");
    seen.add(episode.episodeId); identities.add(identity);
    const start = time(episode.decisionAt), end = start + episode.horizonSeconds * 1000 + policy.executionDelayMs + 5_000;
    let reason: string | null = null;
    if (!isVerifiedCryptoOutcomeSource(episode.sourceVersion)) reason = "quarantined_or_unknown_source";
    else if (episode.baseline.version !== window.baselineVersion || episode.candidate.version !== window.candidateVersion ||
        ![episode.baseline,episode.candidate].every(c => Number.isFinite(time(c.frozenAt)) && time(c.frozenAt) <= train)) reason = "unfrozen_or_wrong_model";
    else if (!Number.isFinite(start) || start < from || end > until) reason = "outside_unseen_window";
    else if (episode.allocatedDollars > Math.min(baselineCapital,candidateCapital)) reason = "allocation_exceeds_remaining_study_capital";
    // Conservative serial portfolio; overlapping positions require a richer
    // allocation/reconciliation model and are not silently counted twice.
    else if (start < previousEnd) reason = "overlapping_portfolio_episode";
    if (reason) { excluded.push({ episodeId:episode.episodeId,reason }); continue; }
    const baseline = simulateCryptoResearchChoice(episode,episode.baseline,policy,window.reportAt);
    const candidate = simulateCryptoResearchChoice(episode,episode.candidate,policy,window.reportAt);
    if ([baseline,candidate].some(result => result.pnlDollars === null)) {
      excluded.push({ episodeId:episode.episodeId,reason:`baseline:${baseline.reason ?? baseline.status};candidate:${candidate.reason ?? candidate.status}` }); continue;
    }
    paired.push({ episodeId:episode.episodeId,marketId:episode.identity.marketId,decisionAt:episode.decisionAt,baseline,candidate });
    baselineCapital += baseline.pnlDollars!; candidateCapital += candidate.pnlDollars!;
    previousEnd = end;
  }
  const summarize = (side: "baseline" | "candidate") => {
    let equity = window.startingCapitalDollars, peak = equity, maxDrawdown = 0;
    let fills = 0, wins = 0, pnl = 0;
    for (const pair of paired) {
      const result = pair[side];
      for (const change of result.observedPnlPath) { const marked = equity + change;
        peak = Math.max(peak,marked); maxDrawdown = Math.max(maxDrawdown,(peak - marked) / peak * 100); }
      equity += result.pnlDollars!; pnl += result.pnlDollars!;
      if (result.status === "filled") { fills++; if (result.pnlDollars! > 0) wins++; }
    }
    return { pairedDecisions:paired.length, filledTrades:fills, noTrades:paired.length - fills,
      netPnlDollars:paired.length ? pnl : null, averagePnlPerDecision:paired.length ? pnl / paired.length : null,
      winRate: fills ? wins / fills : null, observedQuoteDrawdownPercent:paired.length ? maxDrawdown : null };
  };
  const baseline = summarize("baseline"), candidate = summarize("candidate");
  return { version:"crypto-matched-walk-forward-v1", costs:policy, window, baseline, candidate, paired, excluded,
    incrementalNetPnlDollars:baseline.netPnlDollars === null || candidate.netPnlDollars === null ? null : candidate.netPnlDollars - baseline.netPnlDollars,
    limitations:["top_of_book_only","sampled_quote_drawdown_not_tick_complete","serial_nonoverlapping_allocation","no_automatic_promotion"],
    profitabilityEstablished:false, executionAuthorized:false };
}
