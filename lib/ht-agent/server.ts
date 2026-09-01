import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRollingCanonicalDecisionFrame } from "@/lib/canonical-decision-frame";
import { normalizeOpportunity, type Opportunity } from "@/lib/opportunity-model";
import {
  calculatePaperFillPrice,
  estimatePaperSlippageBps,
  getEasternMarketSession,
  isPaperOrderSessionEligible,
  paperQuoteAgeMinutes,
  validatePaperOrder,
  type PaperOrderIntent,
} from "@/lib/paper-trading/engine";
import { getPaperTradingQuote } from "@/lib/paper-trading/quote";
import {
  accountState,
  createBracketChildren,
  findPaperPosition,
  getOrCreatePaperAccount,
  loadPaperDashboard,
  positionState,
  type PaperServerContext,
} from "@/lib/paper-trading/server";
import { fetchMassiveLastQuote } from "@/lib/massive-stocks";
import {
  HT_AGENT_COHORT_VERSION,
  HT_AGENT_FRAME_VERSION,
  type HtAgentDecision,
  type HtAgentDecisionFrame,
  type HtAgentMode,
  type HtAgentProxEvidence,
} from "./contracts";
import { buildHtAgentCohorts, decideHtAgentAction } from "./decision";
import { DEFAULT_HT_AGENT_RISK_POLICY, evaluateHtAgentRisk } from "./risk";
import { getEasternDayStart, getHtAgentSessionCloseTarget } from "./time";

type AgentProfileRow = {
  id: string;
  user_id: string;
  paper_account_id: string;
  mode: HtAgentMode;
  status: "active" | "paused";
  kill_switch: boolean;
  policy_version: string;
  risk_policy: Record<string, unknown> | null;
};

type ProxMemberRow = {
  ticker: string;
  decision_at: string;
  edge_score: number | string;
  evidence_confidence: number | string;
  disposition: string;
  disposition_reason: string;
  hard_failures: unknown;
  reasons: unknown;
};

type ProxRunRow = { id: string; decision_at: string; complete: boolean; status: string };

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringArray = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

function policyFromProfile(profile: AgentProfileRow) {
  const overrides = profile.risk_policy ?? {};
  return {
    ...DEFAULT_HT_AGENT_RISK_POLICY,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => Number.isFinite(Number(value))),
    ),
    version: DEFAULT_HT_AGENT_RISK_POLICY.version,
  };
}

export async function getOrCreateHtAgentProfile(
  context: PaperServerContext,
): Promise<AgentProfileRow> {
  const account = await getOrCreatePaperAccount(context);
  const existing = await context.service
    .from("ht_agent_profiles")
    .select("id,user_id,paper_account_id,mode,status,kill_switch,policy_version,risk_policy")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as AgentProfileRow;
  const created = await context.service
    .from("ht_agent_profiles")
    .insert({ user_id: context.user.id, paper_account_id: account.id })
    .select("id,user_id,paper_account_id,mode,status,kill_switch,policy_version,risk_policy")
    .single();
  if (created.error) throw created.error;
  return created.data as AgentProfileRow;
}

async function globalControl(service: SupabaseClient) {
  const result = await service
    .from("ht_agent_global_control")
    .select("kill_switch,reason,policy_version,updated_at")
    .eq("id", "global")
    .single();
  if (result.error) throw result.error;
  return result.data as {
    kill_switch: boolean;
    reason: string;
    policy_version: string;
    updated_at: string;
  };
}

export async function configureHtAgentProfile(
  context: PaperServerContext,
  input: { mode?: HtAgentMode; killSwitch?: boolean },
) {
  const profile = await getOrCreateHtAgentProfile(context);
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.mode) update.mode = input.mode;
  if (typeof input.killSwitch === "boolean") update.kill_switch = input.killSwitch;
  const result = await context.service
    .from("ht_agent_profiles")
    .update(update)
    .eq("id", profile.id)
    .eq("user_id", context.user.id)
    .select("id,user_id,paper_account_id,mode,status,kill_switch,policy_version,risk_policy")
    .single();
  if (result.error) throw result.error;
  const controlEvent = await context.service.from("ht_agent_control_events").insert({
    scope: "profile",
    profile_id: profile.id,
    user_id: context.user.id,
    event_type: "profile_control_changed",
    previous_state: { mode: profile.mode, status: profile.status, kill_switch: profile.kill_switch },
    next_state: { mode: result.data.mode, status: result.data.status, kill_switch: result.data.kill_switch },
    reason: "Authenticated profile control update",
  });
  if (controlEvent.error) throw controlEvent.error;
  return result.data as AgentProfileRow;
}

async function loadProxEvidence(
  service: SupabaseClient,
  symbols: string[],
): Promise<{ run: ProxRunRow | null; members: Map<string, ProxMemberRow> }> {
  const runResult = await service
    .from("prox_shadow_board_runs")
    .select("id,decision_at,complete,status")
    .eq("complete", true)
    .eq("status", "success")
    .order("decision_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runResult.error) throw runResult.error;
  const run = runResult.data as ProxRunRow | null;
  if (!run) return { run: null, members: new Map() };
  const memberResult = await service
    .from("prox_shadow_board_members")
    .select("ticker,decision_at,edge_score,evidence_confidence,disposition,disposition_reason,hard_failures,reasons")
    .eq("run_id", run.id)
    .in("ticker", symbols);
  if (memberResult.error) throw memberResult.error;
  return {
    run,
    members: new Map(
      ((memberResult.data ?? []) as ProxMemberRow[]).map((row) => [row.ticker, row]),
    ),
  };
}

function proxEvidence(run: ProxRunRow | null, member?: ProxMemberRow): HtAgentProxEvidence {
  if (!run || !member) {
    return {
      runId: run?.id ?? null,
      decisionTimestamp: run?.decision_at ?? null,
      stance: "abstain",
      disposition: null,
      edgeScore: null,
      evidenceConfidence: null,
      reasons: ["No timestamp-aligned independent ProX member exists for this ticker."],
    };
  }
  const failures = stringArray(member.hard_failures);
  const reasons = [member.disposition_reason, ...failures, ...stringArray(member.reasons)]
    .filter(Boolean)
    .slice(0, 8);
  const confidence = number(member.evidence_confidence);
  const stance = member.disposition === "selected"
    ? "support"
    : member.disposition === "blocked" && failures.length > 0
      ? "veto"
      : member.disposition === "blocked" || member.disposition === "rejected"
        ? "warn"
        : "abstain";
  return {
    runId: run.id,
    decisionTimestamp: member.decision_at,
    stance,
    disposition: member.disposition,
    edgeScore: number(member.edge_score),
    evidenceConfidence: confidence,
    reasons,
  };
}

function canonicalLevels(opportunity: Opportunity) {
  const framework = opportunity.tradeFramework;
  const entry = opportunity.price > 0 ? opportunity.price : null;
  const downside = framework?.downsideRisk ?? opportunity.explosionAssessment?.structuralDownsidePercent ?? null;
  const upside = framework?.upsideMin ?? opportunity.explosionAssessment?.scenarioBands?.base.min ?? null;
  return {
    entry,
    stop: entry && downside && downside > 0 ? entry * (1 - downside / 100) : null,
    target: entry && upside && upside > 0 ? entry * (1 + upside / 100) : null,
  };
}

function hasExplicitHaltEvidence(opportunity: Opportunity) {
  return [...opportunity.riskTags, ...opportunity.signals].some((value) =>
    /\b(halt(?:ed)?|suspend(?:ed)?)\b/i.test(value),
  );
}

function requireCanonicalSourceRunId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("HT Agent requires an authoritative Canonical source run id.");
  }
  return value;
}

async function paperDailyPnl(service: SupabaseClient, accountId: string) {
  const now = new Date();
  const start = getEasternDayStart(now);
  const result = await service
    .from("paper_ledger_entries")
    .select("realized_pnl_delta")
    .eq("account_id", accountId)
    .gte("created_at", start);
  if (result.error) throw result.error;
  return (result.data ?? []).reduce(
    (sum, row) => sum + number(row.realized_pnl_delta),
    0,
  );
}

async function buildFrame(
  context: PaperServerContext,
  profile: AgentProfileRow,
  runId: string,
  opportunity: Opportunity,
  rank: number,
  canonicalDecisionTimestamp: string,
  canonicalSourceRunId: string,
  canonicalEngineVersion: string,
  proxRun: ProxRunRow | null,
  proxMember: ProxMemberRow | undefined,
): Promise<HtAgentDecisionFrame> {
  const sourceRunId = requireCanonicalSourceRunId(canonicalSourceRunId);
  const [quote, nbbo, dashboard, dailyPnl] = await Promise.all([
    getPaperTradingQuote(opportunity.ticker),
    fetchMassiveLastQuote(opportunity.ticker),
    loadPaperDashboard(context),
    paperDailyPnl(context.service, profile.paper_account_id),
  ]);
  const position = dashboard.positions.find((item) => item.symbol === opportunity.ticker);
  const pending = dashboard.orders.some(
    (item) => item.symbol === opportunity.ticker && ["accepted", "open", "partially_filled"].includes(item.status),
  );
  const bid = nbbo?.bid ?? null;
  const ask = nbbo?.ask ?? null;
  const midpoint = bid && ask ? (bid + ask) / 2 : null;
  const spreadPercent = midpoint && ask && bid ? (ask - bid) / midpoint * 100 : null;
  const badPrint = Boolean(
    bid && ask && (quote.price < bid * 0.9 || quote.price > ask * 1.1),
  );
  const levels = canonicalLevels(opportunity);
  const prox = proxEvidence(proxRun, proxMember);
  const capturedAt = new Date().toISOString();
  return {
    version: HT_AGENT_FRAME_VERSION,
    frameId: crypto.randomUUID(),
    capturedAt,
    market: {
      symbol: opportunity.ticker,
      price: quote.price,
      bid,
      ask,
      spreadPercent,
      volume: quote.volume,
      dollarVolume: quote.volume * quote.price,
      relativeVolume: opportunity.relativeVolume,
      providerTimestamp: quote.timestamp,
      source: quote.source,
      marketSession: getEasternMarketSession(),
      halted: hasExplicitHaltEvidence(opportunity),
      badPrint,
    },
    canonical: {
      sourceRunId,
      engineVersion: canonicalEngineVersion,
      decisionTimestamp: canonicalDecisionTimestamp,
      eligible: opportunity.displayEligibility?.eligible === true,
      rank,
      tier: opportunity.tier ?? "scanner",
      score: opportunity.strategyScore ?? opportunity.opportunityScore,
      strategy: opportunity.strategy ?? "spot_momentum",
      reasons: opportunity.displayEligibility?.reasons ?? opportunity.eligibility?.reasons ?? [],
      proposedEntry: levels.entry,
      proposedStop: levels.stop,
      proposedTarget: levels.target,
    },
    prox,
    catalyst: {
      state: opportunity.catalystScore >= 20 ? "verified" : "unavailable",
      score: opportunity.catalystScore,
      tags: opportunity.catalystTags,
      observedAt: opportunity.catalystScore >= 20 ? canonicalDecisionTimestamp : null,
    },
    paper: {
      accountId: profile.paper_account_id,
      equity: dashboard.account.equity,
      buyingPower: dashboard.account.buyingPower,
      cash: dashboard.account.cashBalance,
      dailyPnl,
      grossExposure: dashboard.positions.reduce((sum, item) => sum + Math.abs(item.marketValue ?? 0), 0),
      openPositionCount: dashboard.positions.length,
      symbolPositionQuantity: position ? (position.side === "long" ? position.quantity : -position.quantity) : 0,
      symbolPositionValue: Math.abs(position?.marketValue ?? 0),
      pendingOrderForSymbol: pending,
    },
  };
}

async function buildManagedPositionFrame(
  context: PaperServerContext,
  profile: AgentProfileRow,
  prior: Record<string, unknown>,
  proxRun: ProxRunRow | null,
  proxMember: ProxMemberRow | undefined,
): Promise<HtAgentDecisionFrame> {
  const symbol = String(prior.symbol);
  const [quote, nbbo, dashboard, dailyPnl] = await Promise.all([
    getPaperTradingQuote(symbol),
    fetchMassiveLastQuote(symbol),
    loadPaperDashboard(context),
    paperDailyPnl(context.service, profile.paper_account_id),
  ]);
  const position = dashboard.positions.find((item) => item.symbol === symbol);
  if (!position) throw new Error(`Managed paper position ${symbol} is no longer open.`);
  const bid = nbbo?.bid ?? null;
  const ask = nbbo?.ask ?? null;
  const midpoint = bid && ask ? (bid + ask) / 2 : null;
  const canonical = prior.canonical_evidence as HtAgentDecisionFrame["canonical"];
  return {
    version: HT_AGENT_FRAME_VERSION,
    frameId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    market: {
      symbol,
      price: quote.price,
      bid,
      ask,
      spreadPercent: midpoint && bid && ask ? (ask - bid) / midpoint * 100 : null,
      volume: quote.volume,
      dollarVolume: quote.volume * quote.price,
      relativeVolume: number((prior.market_facts as Record<string, unknown>)?.relativeVolume, 0),
      providerTimestamp: quote.timestamp,
      source: quote.source,
      marketSession: getEasternMarketSession(),
      halted: false,
      badPrint: Boolean(bid && ask && (quote.price < bid * 0.9 || quote.price > ask * 1.1)),
    },
    canonical,
    prox: proxEvidence(proxRun, proxMember),
    catalyst: prior.catalyst_evidence as HtAgentDecisionFrame["catalyst"],
    paper: {
      accountId: profile.paper_account_id,
      equity: dashboard.account.equity,
      buyingPower: dashboard.account.buyingPower,
      cash: dashboard.account.cashBalance,
      dailyPnl,
      grossExposure: dashboard.positions.reduce((sum, item) => sum + Math.abs(item.marketValue ?? 0), 0),
      openPositionCount: dashboard.positions.length,
      symbolPositionQuantity: position.side === "long" ? position.quantity : -position.quantity,
      symbolPositionValue: Math.abs(position.marketValue ?? 0),
      pendingOrderForSymbol: dashboard.orders.some(
        (item) => item.symbol === symbol && ["accepted", "open", "partially_filled"].includes(item.status),
      ),
    },
  };
}

function hashFrame(frame: HtAgentDecisionFrame) {
  return createHash("sha256").update(JSON.stringify(frame, (key, value) =>
    key === "frameId" ? undefined : value,
  )).digest("hex");
}

async function persistDecision(
  context: PaperServerContext,
  profile: AgentProfileRow,
  runId: string,
  frame: HtAgentDecisionFrame,
  decision: HtAgentDecision,
) {
  const frameHash = hashFrame(frame);
  const frameInsert = await context.service.from("ht_agent_decision_frames").insert({
    id: frame.frameId,
    profile_id: profile.id,
    user_id: context.user.id,
    run_id: runId,
    frame_version: frame.version,
    frame_hash: frameHash,
    symbol: frame.market.symbol,
    captured_at: frame.capturedAt,
    provider_timestamp: frame.market.providerTimestamp,
    canonical_decision_timestamp: frame.canonical.decisionTimestamp,
    prox_decision_timestamp: frame.prox.decisionTimestamp,
    canonical_source_run_id: frame.canonical.sourceRunId,
    prox_source_run_id: frame.prox.runId,
    market_facts: frame.market,
    canonical_evidence: frame.canonical,
    prox_evidence: frame.prox,
    catalyst_evidence: frame.catalyst,
    paper_account_state: frame.paper,
  });
  if (frameInsert.error) {
    if (frameInsert.error.code === "23505") return null;
    throw frameInsert.error;
  }
  const state = decision.requiresApproval ? "pending_approval" : "recorded";
  const decisionInsert = await context.service.from("ht_agent_decisions").insert({
    profile_id: profile.id,
    user_id: context.user.id,
    run_id: runId,
    frame_id: frame.frameId,
    symbol: frame.market.symbol,
    decision_version: decision.version,
    policy_version: decision.risk.policyVersion,
    mode: profile.mode,
    action: decision.action,
    state,
    proposed_entry: decision.risk.proposedEntry,
    proposed_stop: decision.risk.proposedStop,
    proposed_target: decision.risk.proposedTarget,
    proposed_quantity: decision.risk.quantity,
    maximum_risk: decision.risk.maximumRisk,
    estimated_notional: decision.risk.estimatedNotional,
    risk_allowed: decision.risk.allowed,
    risk_rules: decision.risk.rules,
    explanation: decision.explanation,
  }).select("id").single();
  if (decisionInsert.error) throw decisionInsert.error;
  const decisionId = String(decisionInsert.data.id);
  const cohorts = buildHtAgentCohorts(frame, decision);
  const cohortInsert = await context.service.from("ht_agent_cohort_observations").insert(
    cohorts.map((cohort) => ({
      decision_id: decisionId,
      frame_id: frame.frameId,
      profile_id: profile.id,
      user_id: context.user.id,
      cohort_version: HT_AGENT_COHORT_VERSION,
      cohort: cohort.cohort,
      would_enter: cohort.wouldEnter,
      reason: cohort.reason,
      decision_price: frame.market.price,
      conservative_slippage_bps: DEFAULT_HT_AGENT_RISK_POLICY.conservativeSlippageBps,
      observed_at: frame.capturedAt,
    })),
  ).select("id,cohort");
  if (cohortInsert.error) throw cohortInsert.error;
  const event = await context.service.from("ht_agent_decision_events").insert({
    decision_id: decisionId,
    profile_id: profile.id,
    user_id: context.user.id,
    event_type: decision.action === "prepare" ? "proposal_created" : "decision_recorded",
    detail: { action: decision.action, risk_allowed: decision.risk.allowed, frame_hash: frameHash },
  });
  if (event.error) throw event.error;
  const horizons = [
    ["30s", 30], ["1m", 60], ["5m", 300], ["15m", 900],
    ["30m", 1800], ["60m", 3600], ["session", 23_400],
  ] as const;
  const persistedCohorts = cohortInsert.data ?? [];
  const outcomeInsert = await context.service.from("ht_agent_outcomes").insert(
    horizons.flatMap(([horizon, seconds]) => persistedCohorts.map((cohort) => ({
      decision_id: decisionId,
      profile_id: profile.id,
      user_id: context.user.id,
      horizon,
      target_at: horizon === "session"
        ? getHtAgentSessionCloseTarget(frame.capturedAt)
        : new Date(Date.parse(frame.capturedAt) + seconds * 1000).toISOString(),
      cohort_observation_id: cohort.id,
      complete: false,
    }))),
  );
  if (outcomeInsert.error) throw outcomeInsert.error;
  return decisionId;
}

async function submitHtAgentPaperOrder(
  context: PaperServerContext,
  profile: AgentProfileRow,
  decisionId: string,
  frame: HtAgentDecisionFrame,
  decision: HtAgentDecision,
) {
  if (!decision.executableInPaper) return null;
  const isReducing = decision.action === "exit" || decision.action === "reduce";
  const position = await findPaperPosition(context.service, profile.paper_account_id, frame.market.symbol);
  const signedQuantity = number(position?.quantity);
  const quantity = isReducing
    ? decision.action === "exit" ? Math.abs(signedQuantity) : Math.max(1, Math.floor(Math.abs(signedQuantity) / 2))
    : decision.risk.quantity;
  if (!(quantity > 0)) throw new Error("HT Agent paper quantity is unavailable.");
  const side: PaperOrderIntent["side"] = isReducing
    ? signedQuantity > 0 ? "sell" : "buy_to_cover"
    : "buy";
  const quote = await getPaperTradingQuote(frame.market.symbol);
  const intent: PaperOrderIntent = {
    symbol: frame.market.symbol,
    side,
    orderType: "market",
    timeInForce: "day",
    quantity,
    limitPrice: null,
    stopPrice: null,
    allowExtendedHours: false,
    takeProfitPrice: isReducing ? null : decision.risk.proposedTarget,
    stopLossPrice: isReducing ? null : decision.risk.proposedStop,
    strategySource: "ht_agent",
  };
  const account = await getOrCreatePaperAccount(context);
  const validation = validatePaperOrder(intent, accountState(account), positionState(position), quote);
  if (!validation.ok) throw new Error(validation.reason ?? "Paper order rejected.");
  const session = getEasternMarketSession();
  const shouldFill = isPaperOrderSessionEligible(session, false);
  const maxQuoteAge = quote.dataMode === "real_time" ? 2 : 35;
  if (shouldFill && paperQuoteAgeMinutes(quote) > maxQuoteAge) {
    throw new Error("Provider quote became stale before the paper fill.");
  }
  const inserted = await context.service.from("paper_orders").insert({
    account_id: profile.paper_account_id,
    user_id: context.user.id,
    client_order_id: decisionId,
    ht_agent_decision_id: decisionId,
    symbol: intent.symbol,
    side,
    order_type: "market",
    time_in_force: "day",
    quantity,
    allow_extended_hours: false,
    status: shouldFill ? "accepted" : "open",
    order_class: isReducing ? "simple" : "bracket_parent",
    reduce_only: isReducing,
    bracket_take_profit_price: intent.takeProfitPrice,
    bracket_stop_loss_price: intent.stopLossPrice,
    strategy_source: "ht_agent",
    quote_price_at_submit: quote.price,
    quote_source_at_submit: quote.source,
    quote_timestamp_at_submit: quote.timestamp,
    data_mode: quote.dataMode,
    context_snapshot: {
      authority: "ht_agent_paper_only",
      decision_id: decisionId,
      frame_id: frame.frameId,
      policy_version: decision.risk.policyVersion,
    },
  }).select("*").single();
  if (inserted.error) throw inserted.error;
  const order = inserted.data;
  let protectionError: string | null = null;
  await context.service.from("paper_order_events").insert({
    account_id: profile.paper_account_id,
    user_id: context.user.id,
    order_id: order.id,
    event_type: shouldFill ? "accepted" : "opened",
    detail: { authority: "ht_agent_paper_only", decision_id: decisionId },
  });
  if (shouldFill) {
    const slippageBps = Math.max(
      DEFAULT_HT_AGENT_RISK_POLICY.conservativeSlippageBps,
      estimatePaperSlippageBps(quote, validation.estimatedNotional),
    );
    const fillPrice = calculatePaperFillPrice(side, quote.price, slippageBps);
    const fill = await context.service.rpc("paper_apply_fill", {
      p_order_id: order.id,
      p_fill_price: fillPrice,
      p_quote_source: quote.source,
      p_quote_timestamp: quote.timestamp,
      p_slippage_bps: slippageBps,
    });
    if (fill.error) throw fill.error;
    if (!isReducing) {
      try {
        await createBracketChildren(context.service, order);
      } catch (error) {
        protectionError = error instanceof Error ? error.message : "Bracket protection failed";
        const lock = await context.service.from("ht_agent_profiles").update({
          kill_switch: true,
          updated_at: new Date().toISOString(),
        }).eq("id", profile.id).eq("user_id", context.user.id);
        if (lock.error) throw lock.error;
        const protectionEvent = await context.service.from("ht_agent_decision_events").insert({
          decision_id: decisionId,
          profile_id: profile.id,
          user_id: context.user.id,
          event_type: "paper_protection_failed",
          detail: {
            order_id: order.id,
            error: protectionError,
            profile_kill_switch_engaged: true,
          },
        });
        if (protectionEvent.error) throw protectionEvent.error;
      }
    }
    if (isReducing) {
      const activeChildren = await context.service.from("paper_orders")
        .select("id")
        .eq("account_id", profile.paper_account_id)
        .eq("symbol", frame.market.symbol)
        .eq("reduce_only", true)
        .neq("id", order.id)
        .in("status", ["accepted", "open", "partially_filled"]);
      if (activeChildren.error) throw activeChildren.error;
      const childIds = (activeChildren.data ?? []).map((row) => row.id);
      if (childIds.length > 0) {
        const cancelled = await context.service.from("paper_orders").update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          reject_reason: "Replaced by HT Agent risk-reduction decision",
        }).in("id", childIds);
        if (cancelled.error) throw cancelled.error;
        const events = await context.service.from("paper_order_events").insert(childIds.map((orderId) => ({
          account_id: profile.paper_account_id,
          user_id: context.user.id,
          order_id: orderId,
          event_type: "cancelled",
          detail: { authority: "ht_agent_paper_only", replacement_decision_id: decisionId },
        })));
        if (events.error) throw events.error;
      }
    }
  }
  const decisionUpdate = await context.service.from("ht_agent_decisions").update({
    state: shouldFill ? "filled" : "submitted",
    paper_order_id: order.id,
    paper_order_result: {
      order_id: order.id,
      status: shouldFill ? "filled" : "open",
      protection_error: protectionError,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", decisionId);
  if (decisionUpdate.error) throw decisionUpdate.error;
  const orderEvent = await context.service.from("ht_agent_decision_events").insert({
    decision_id: decisionId,
    profile_id: profile.id,
    user_id: context.user.id,
    event_type: shouldFill ? "paper_order_filled" : "paper_order_submitted",
    detail: { order_id: order.id, side, quantity, paper_only: true, protection_error: protectionError },
  });
  if (orderEvent.error) throw orderEvent.error;
  return { orderId: order.id, status: shouldFill ? "filled" : "open", protectionError };
}

async function reconcileHtAgentPaperLifecycles(
  context: PaperServerContext,
  profile: AgentProfileRow,
) {
  const [dashboard, entriesResult] = await Promise.all([
    loadPaperDashboard(context),
    context.service.from("ht_agent_decisions")
      .select("id,symbol,proposed_entry,decided_at,state")
      .eq("profile_id", profile.id)
      .eq("action", "enter")
      .in("state", ["filled", "submitted"])
      .order("decided_at", { ascending: true }),
  ]);
  if (entriesResult.error) throw entriesResult.error;
  const openSymbols = new Set(dashboard.positions.map((position) => position.symbol));
  let closed = 0;
  for (const entry of entriesResult.data ?? []) {
    if (openSymbols.has(entry.symbol)) continue;
    const closeOrder = await context.service.from("paper_orders")
      .select("id,filled_at")
      .eq("account_id", profile.paper_account_id)
      .eq("symbol", entry.symbol)
      .in("side", ["sell", "buy_to_cover"])
      .eq("status", "filled")
      .gte("filled_at", entry.decided_at)
      .order("filled_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (closeOrder.error) throw closeOrder.error;
    if (!closeOrder.data) continue;
    const fill = await context.service.from("paper_fills")
      .select("price,quote_timestamp,filled_at")
      .eq("order_id", closeOrder.data.id)
      .maybeSingle();
    if (fill.error) throw fill.error;
    if (!fill.data) continue;
    const update = await context.service.from("ht_agent_decisions").update({
      state: "closed",
      updated_at: new Date().toISOString(),
    }).eq("id", entry.id).in("state", ["filled", "submitted"]);
    if (update.error) throw update.error;
    const event = await context.service.from("ht_agent_decision_events").insert({
      decision_id: entry.id,
      profile_id: profile.id,
      user_id: context.user.id,
      event_type: "paper_position_closed",
      detail: {
        close_order_id: closeOrder.data.id,
        fill_price: number(fill.data.price),
        provider_timestamp: fill.data.quote_timestamp,
        closed_at: fill.data.filled_at,
      },
    });
    if (event.error) throw event.error;
    const entryPrice = number(entry.proposed_entry);
    const outcome = await context.service.from("ht_agent_outcomes").insert({
      decision_id: entry.id,
      profile_id: profile.id,
      user_id: context.user.id,
      cohort_observation_id: null,
      horizon: "exit",
      target_at: fill.data.filled_at,
      observed_at: fill.data.filled_at,
      provider_timestamp: fill.data.quote_timestamp,
      price: number(fill.data.price),
      return_percent: entryPrice > 0 ? (number(fill.data.price) - entryPrice) / entryPrice * 100 : null,
      complete: true,
    });
    if (outcome.error && outcome.error.code !== "23505") throw outcome.error;
    closed += 1;
  }
  return closed;
}

function canExecutePaperAction(
  profile: AgentProfileRow,
  control: { kill_switch: boolean },
  decision: HtAgentDecision,
) {
  if (profile.mode !== "paper_autopilot" || !decision.executableInPaper) return false;
  const riskReducing = decision.action === "exit" || decision.action === "reduce";
  return riskReducing || (!control.kill_switch && !profile.kill_switch && profile.status === "active");
}

export async function runHtAgentCycle(context: PaperServerContext) {
  const profile = await getOrCreateHtAgentProfile(context);
  const reconciledClosures = await reconcileHtAgentPaperLifecycles(context, profile);
  const control = await globalControl(context.service);
  const canonical = await getRollingCanonicalDecisionFrame("momentum");
  const opportunities = (canonical.opportunities ?? [])
    .slice(0, 6)
    .map(normalizeOpportunity);
  const canonicalSourceRun = "sourceRun" in canonical ? canonical.sourceRun : null;
  const paperBeforeCycle = await loadPaperDashboard(context);
  const agentEntryOrders = await context.service.from("paper_orders")
    .select("symbol")
    .eq("account_id", profile.paper_account_id)
    .eq("strategy_source", "ht_agent")
    .eq("status", "filled")
    .eq("side", "buy");
  if (agentEntryOrders.error) throw agentEntryOrders.error;
  const agentSymbols = new Set((agentEntryOrders.data ?? []).map((row) => String(row.symbol)));
  const managedSymbols = paperBeforeCycle.positions
    .filter((position) => agentSymbols.has(position.symbol))
    .map((position) => position.symbol);
  const recentRunResult = await context.service.from("ht_agent_runs")
    .select("id,status,started_at")
    .eq("profile_id", profile.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentRunResult.error) throw recentRunResult.error;
  if (recentRunResult.data) {
    const ageSeconds = (Date.now() - Date.parse(recentRunResult.data.started_at)) / 1000;
    if (recentRunResult.data.status === "running" && ageSeconds < 300) {
      throw new Error("An HT Agent decision cycle is already running for this profile.");
    }
    if (ageSeconds < 30) {
      throw new Error("HT Agent cycle cooldown is active; wait for the current provider frame to advance.");
    }
  }
  const runInsert = await context.service.from("ht_agent_runs").insert({
    profile_id: profile.id,
    user_id: context.user.id,
    mode: profile.mode,
    candidate_count: opportunities.length,
  }).select("id").single();
  if (runInsert.error) throw runInsert.error;
  const runId = String(runInsert.data.id);
  try {
    const prox = await loadProxEvidence(
      context.service,
      [...new Set([...opportunities.map((item) => item.ticker), ...managedSymbols])],
    );
    const managedFrameResult = managedSymbols.length > 0
      ? await context.service.from("ht_agent_decision_frames")
        .select("id,symbol,market_facts,canonical_evidence,catalyst_evidence,captured_at")
        .eq("profile_id", profile.id)
        .in("symbol", managedSymbols)
        .order("captured_at", { ascending: false })
      : { data: [], error: null };
    if (managedFrameResult.error) throw managedFrameResult.error;
    const latestManagedFrames = new Map<string, Record<string, unknown>>();
    for (const row of managedFrameResult.data ?? []) {
      const symbol = String(row.symbol);
      if (!latestManagedFrames.has(symbol)) {
        latestManagedFrames.set(symbol, row as Record<string, unknown>);
      }
    }
    let decisions = 0;
    let orders = 0;
    for (let index = 0; index < opportunities.length; index += 1) {
      const opportunity = opportunities[index];
      const priorManagedFrame = latestManagedFrames.get(opportunity.ticker);
      const frame = priorManagedFrame
        ? await buildManagedPositionFrame(
          context,
          profile,
          priorManagedFrame,
          prox.run,
          prox.members.get(opportunity.ticker),
        )
        : await buildFrame(
          context,
          profile,
          runId,
          opportunity,
          index + 1,
          canonical.decisionFrame.decisionAsOf,
          String(canonicalSourceRun?.id ?? opportunity.sourceRunId ?? ""),
          String(canonical.engineVersion),
          prox.run,
          prox.members.get(opportunity.ticker),
        );
      const duplicateResult = await context.service.from("ht_agent_decisions")
        .select("id")
        .eq("profile_id", profile.id)
        .eq("symbol", opportunity.ticker)
        .in("state", ["pending_approval", "approved", "submitted", "filled"])
        .gte("decided_at", new Date(Date.now() - 5 * 60_000).toISOString())
        .limit(1);
      if (duplicateResult.error) throw duplicateResult.error;
      const risk = evaluateHtAgentRisk(frame, {
        globalKillSwitch: control.kill_switch,
        profileKillSwitch: profile.kill_switch || profile.status !== "active",
        duplicateDecision: (duplicateResult.data ?? []).length > 0,
      }, policyFromProfile(profile));
      const decision = decideHtAgentAction(frame, risk, profile.mode);
      const decisionId = await persistDecision(context, profile, runId, frame, decision);
      if (!decisionId) continue;
      decisions += 1;
      if (canExecutePaperAction(profile, control, decision)) {
        try {
          const result = await submitHtAgentPaperOrder(context, profile, decisionId, frame, decision);
          if (result) orders += 1;
        } catch (error) {
          await context.service.from("ht_agent_decisions").update({
            state: "failed",
            paper_order_result: { error: error instanceof Error ? error.message : "Paper submission failed" },
            updated_at: new Date().toISOString(),
          }).eq("id", decisionId);
          await context.service.from("ht_agent_decision_events").insert({
            decision_id: decisionId,
            profile_id: profile.id,
            user_id: context.user.id,
            event_type: "paper_order_failed",
            detail: { error: error instanceof Error ? error.message : "Paper submission failed" },
          });
        }
      }
    }
    const currentSymbols = new Set(opportunities.map((item) => item.ticker));
    for (const symbol of managedSymbols.filter((item) => !currentSymbols.has(item))) {
      const priorFrame = latestManagedFrames.get(symbol);
      if (!priorFrame) continue;
      const frame = await buildManagedPositionFrame(
        context,
        profile,
        priorFrame,
        prox.run,
        prox.members.get(symbol),
      );
      const risk = evaluateHtAgentRisk(frame, {
        globalKillSwitch: control.kill_switch,
        profileKillSwitch: profile.kill_switch || profile.status !== "active",
        duplicateDecision: false,
      }, policyFromProfile(profile));
      const decision = decideHtAgentAction(frame, risk, profile.mode);
      const decisionId = await persistDecision(context, profile, runId, frame, decision);
      if (!decisionId) continue;
      decisions += 1;
      if (canExecutePaperAction(profile, control, decision)) {
        const result = await submitHtAgentPaperOrder(context, profile, decisionId, frame, decision);
        if (result) orders += 1;
      }
    }
    await context.service.from("ht_agent_runs").update({
      status: "success",
      completed_at: new Date().toISOString(),
      decision_count: decisions,
      order_count: orders,
      diagnostics: {
        canonical_source_run_id: canonicalSourceRun?.id ?? null,
        canonical_decision_at: canonical.decisionFrame.decisionAsOf,
        prox_source_run_id: prox.run?.id ?? null,
        global_kill_switch: control.kill_switch,
        paper_only: true,
        reconciled_closures: reconciledClosures,
      },
    }).eq("id", runId);
    return { runId, decisions, orders };
  } catch (error) {
    await context.service.from("ht_agent_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : "Agent cycle failed",
    }).eq("id", runId);
    throw error;
  }
}

export async function resolveHtAgentProposal(
  context: PaperServerContext,
  decisionId: string,
  approve: boolean,
) {
  const profile = await getOrCreateHtAgentProfile(context);
  const control = await globalControl(context.service);
  const result = await context.service.from("ht_agent_decisions")
    .select("id,run_id,frame_id,symbol,action,state,explanation")
    .eq("id", decisionId)
    .eq("profile_id", profile.id)
    .eq("state", "pending_approval")
    .single();
  if (result.error) throw result.error;
  if (!approve) {
    await context.service.from("ht_agent_decisions").update({ state: "declined", updated_at: new Date().toISOString() }).eq("id", decisionId);
    await context.service.from("ht_agent_decision_events").insert({
      decision_id: decisionId, profile_id: profile.id, user_id: context.user.id,
      event_type: "proposal_declined", detail: { authority: "user" },
    });
    return { decisionId, state: "declined" };
  }
  const row = result.data as Record<string, unknown>;
  const requestedAction = String(row.action);
  const riskReducing = requestedAction === "exit" || requestedAction === "reduce";
  if (!riskReducing && (control.kill_switch || profile.kill_switch || profile.status !== "active")) {
    throw new Error("HT Agent kill switch is active.");
  }
  const symbol = String(row.symbol);
  const currentProx = await loadProxEvidence(context.service, [symbol]);
  let frame: HtAgentDecisionFrame;
  if (riskReducing) {
    const priorResult = await context.service.from("ht_agent_decision_frames")
      .select("id,symbol,market_facts,canonical_evidence,catalyst_evidence")
      .eq("id", String(row.frame_id))
      .eq("profile_id", profile.id)
      .single();
    if (priorResult.error) throw priorResult.error;
    frame = await buildManagedPositionFrame(
      context,
      profile,
      priorResult.data as Record<string, unknown>,
      currentProx.run,
      currentProx.members.get(symbol),
    );
  } else {
    const canonical = await getRollingCanonicalDecisionFrame("momentum");
    const currentIndex = (canonical.opportunities ?? []).findIndex(
      (item) => String((item as { ticker?: unknown }).ticker ?? "").toUpperCase() === symbol,
    );
    const currentOpportunityRaw = currentIndex >= 0 ? canonical.opportunities[currentIndex] : null;
    if (!currentOpportunityRaw) throw new Error("The proposal is no longer present in the current Canonical frame.");
    const opportunity = normalizeOpportunity(currentOpportunityRaw);
    const sourceRun = "sourceRun" in canonical ? canonical.sourceRun : null;
    frame = await buildFrame(
      context,
      profile,
      String(row.run_id),
      opportunity,
      currentIndex + 1,
      canonical.decisionFrame.decisionAsOf,
      String(sourceRun?.id ?? opportunity.sourceRunId ?? ""),
      String(canonical.engineVersion),
      currentProx.run,
      currentProx.members.get(opportunity.ticker),
    );
  }
  const risk = evaluateHtAgentRisk(frame, {
    globalKillSwitch: control.kill_switch,
    profileKillSwitch: profile.kill_switch || profile.status !== "active",
    duplicateDecision: false,
  }, policyFromProfile(profile));
  const refreshedDecision = decideHtAgentAction(frame, risk, "paper_autopilot");
  const expectedAction = riskReducing ? requestedAction : "enter";
  if (refreshedDecision.action !== expectedAction || (!riskReducing && !risk.allowed)) {
    throw new Error(`Approval revalidation failed: ${refreshedDecision.explanation}`);
  }
  const frameHash = hashFrame(frame);
  const revalidationFrame = await context.service.from("ht_agent_decision_frames").insert({
    id: frame.frameId,
    profile_id: profile.id,
    user_id: context.user.id,
    run_id: String(row.run_id),
    frame_version: frame.version,
    frame_hash: frameHash,
    symbol: frame.market.symbol,
    captured_at: frame.capturedAt,
    provider_timestamp: frame.market.providerTimestamp,
    canonical_decision_timestamp: frame.canonical.decisionTimestamp,
    prox_decision_timestamp: frame.prox.decisionTimestamp,
    canonical_source_run_id: frame.canonical.sourceRunId,
    prox_source_run_id: frame.prox.runId,
    market_facts: frame.market,
    canonical_evidence: frame.canonical,
    prox_evidence: frame.prox,
    catalyst_evidence: frame.catalyst,
    paper_account_state: frame.paper,
  });
  if (revalidationFrame.error) throw revalidationFrame.error;
  await context.service.from("ht_agent_decisions").update({
    state: "approved",
    approval_frame_id: frame.frameId,
    proposed_entry: risk.proposedEntry,
    proposed_stop: risk.proposedStop,
    proposed_target: risk.proposedTarget,
    proposed_quantity: risk.quantity,
    maximum_risk: risk.maximumRisk,
    estimated_notional: risk.estimatedNotional,
    risk_allowed: risk.allowed,
    risk_rules: risk.rules,
    explanation: `${String(row.explanation)} Approval was revalidated against a fresh immutable frame.`,
    updated_at: new Date().toISOString(),
  }).eq("id", decisionId);
  await context.service.from("ht_agent_decision_events").insert({
    decision_id: decisionId,
    profile_id: profile.id,
    user_id: context.user.id,
    event_type: "proposal_revalidated",
    detail: { approval_frame_id: frame.frameId, frame_hash: frameHash, provider_timestamp: frame.market.providerTimestamp },
  });
  const order = await submitHtAgentPaperOrder(context, profile, decisionId, frame, refreshedDecision);
  return { decisionId, state: order?.status ?? "approved", order };
}

export async function loadHtAgentDashboard(context: PaperServerContext) {
  const profile = await getOrCreateHtAgentProfile(context);
  const [control, paper, decisions, runs, cohorts, outcomes] = await Promise.all([
    globalControl(context.service),
    loadPaperDashboard(context),
    context.service.from("ht_agent_decisions")
      .select("id,symbol,action,state,mode,proposed_entry,proposed_stop,proposed_target,proposed_quantity,maximum_risk,estimated_notional,risk_allowed,explanation,paper_order_id,paper_order_result,decided_at")
      .eq("profile_id", profile.id).order("decided_at", { ascending: false }).limit(100),
    context.service.from("ht_agent_runs")
      .select("id,status,mode,candidate_count,decision_count,order_count,started_at,completed_at,diagnostics,error_message")
      .eq("profile_id", profile.id).order("started_at", { ascending: false }).limit(20),
    context.service.from("ht_agent_cohort_observations")
      .select("cohort,would_enter").eq("profile_id", profile.id),
    context.service.from("ht_agent_outcomes")
      .select("return_percent,complete,ht_agent_cohort_observations(cohort,would_enter)")
      .eq("profile_id", profile.id)
      .eq("complete", true)
      .not("return_percent", "is", null)
      .limit(5000),
  ]);
  if (decisions.error) throw decisions.error;
  if (runs.error) throw runs.error;
  if (cohorts.error) throw cohorts.error;
  if (outcomes.error) throw outcomes.error;
  const completedOutcomes = (outcomes.data ?? []).flatMap((row) => {
    const relation = row.ht_agent_cohort_observations as unknown as { cohort?: string; would_enter?: boolean } | null;
    const returnPercent = number(row.return_percent, Number.NaN);
    if (!relation?.cohort || !Number.isFinite(returnPercent)) return [];
    return [{ cohort: relation.cohort, wouldEnter: relation.would_enter === true, returnPercent }];
  });
  const cohortMetrics = ["canonical_only", "canonical_prox", "ht_agent_full"].map((cohort) => {
    const rows = (cohorts.data ?? []).filter((row) => row.cohort === cohort);
    const measured = completedOutcomes.filter((row) => row.cohort === cohort && row.wouldEnter);
    const averageReturnPercent = measured.length > 0
      ? measured.reduce((sum, row) => sum + row.returnPercent, 0) / measured.length
      : null;
    const positiveRatePercent = measured.length > 0
      ? measured.filter((row) => row.returnPercent > 0).length / measured.length * 100
      : null;
    return {
      cohort,
      observations: rows.length,
      wouldEnter: rows.filter((row) => row.would_enter).length,
      measuredOutcomes: measured.length,
      averageReturnPercent,
      positiveRatePercent,
    };
  });
  const decisionRows = decisions.data ?? [];
  const grossExposure = paper.positions.reduce((sum, position) => sum + Math.abs(position.marketValue ?? 0), 0);
  return {
    contractVersion: "ht-agent-api-v1",
    generatedAt: new Date().toISOString(),
    authority: {
      detection: "canonical",
      research: "independent_prox",
      risk: DEFAULT_HT_AGENT_RISK_POLICY.version,
      execution: "ht_labs_paper_only",
      liveBrokerage: false,
    },
    control: {
      globalKillSwitch: control.kill_switch,
      globalReason: control.reason,
      profileKillSwitch: profile.kill_switch,
      mode: profile.mode,
      status: profile.status,
    },
    paper,
    riskUtilization: {
      grossExposure,
      grossExposurePercent: paper.account.equity > 0 ? grossExposure / paper.account.equity * 100 : 0,
      openPositions: paper.positions.length,
      maximumPositions: policyFromProfile(profile).maxOpenPositions,
    },
    watchlist: decisionRows.filter((row) => ["observe", "manage", "reject", "expire"].includes(row.action)).slice(0, 12),
    proposals: decisionRows.filter((row) => row.state === "pending_approval"),
    decisions: decisionRows,
    runs: runs.data ?? [],
    cohortMetrics,
    riskPolicy: policyFromProfile(profile),
  };
}
