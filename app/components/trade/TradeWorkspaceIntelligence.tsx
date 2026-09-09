"use client";
import type { Opportunity } from "@/lib/opportunity-model";
import { marketChartPollingState } from "@/lib/market-chart-polling";
import {
  canonicalLaneLabel,
  describeCanonicalOpportunityFreshness,
  describeWorkspaceReadFreshness,
  type WorkspaceCanonicalDecisionFrame,
  type WorkspaceReadFreshnessState,
} from "@/lib/workspace-intelligence-display";

type WorkspaceOpportunity = Opportunity & {
  decisionQuoteAsOf?: string | null;
  proxMarketDataAligned?: boolean | null;
};

function formatEt(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function freshnessTone(state: WorkspaceReadFreshnessState) {
  if (state === "fresh") return "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300";
  if (state === "aging") return "border-amber-400/20 bg-amber-500/[0.07] text-amber-200";
  if (state === "stale" || state === "misaligned") return "border-red-400/20 bg-red-500/[0.07] text-red-300";
  return "border-white/[0.07] bg-white/[0.025] text-zinc-300";
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "violet" | "neutral" }) {
  return (
    <div className="rounded-xl border border-white/[0.065] bg-black/25 px-3 py-2.5">
      <p className="text-[7px] font-black uppercase tracking-[0.14em] text-zinc-700">{label}</p>
      <p className={`mt-1 font-mono text-[11px] font-black ${tone === "positive" ? "text-emerald-400" : tone === "violet" ? "text-violet-300" : "text-zinc-300"}`}>{value}</p>
    </div>
  );
}

function LoadingRead() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-32 rounded-lg bg-white/[0.06]" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-16 rounded-xl bg-white/[0.035]" />
        <div className="h-16 rounded-xl bg-white/[0.035]" />
      </div>
      <div className="h-28 rounded-xl bg-white/[0.035]" />
      <div className="h-28 rounded-xl bg-white/[0.035]" />
    </div>
  );
}

export default function TradeWorkspaceIntelligence({
  symbol,
  opportunity,
  decisionFrame,
  loading,
  unavailable,
  message,
  chartAsOf,
  refreshError,
  trustedNowMs,
}: {
  symbol: string;
  opportunity: WorkspaceOpportunity | null;
  decisionFrame: WorkspaceCanonicalDecisionFrame | null;
  loading: boolean;
  unavailable: boolean;
  message: string | null;
  chartAsOf: string | null;
  refreshError: string | null;
  trustedNowMs: number;
}) {
  // Use the same holiday/early-close-aware presentation clock as the chart so
  // an intelligence receipt cannot remain labelled fresh after polling stops.
  const nowMs = trustedNowMs > 0
    ? trustedNowMs
    : Date.parse(decisionFrame?.presentedAt ?? "");
  const marketActive = marketChartPollingState(
    new Date(Number.isFinite(nowMs) ? nowMs : 0),
    "extended",
  ).active;

  if (loading) return <LoadingRead />;

  if (!opportunity) {
    return (
      <section
        className="rounded-2xl border border-white/[0.07] bg-white/[0.018] p-4"
        data-ht-read="none"
        data-chart-as-of={chartAsOf ?? ""}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/15 bg-violet-500/[0.07] text-violet-300">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M4 18V9M10 18V5M16 18v-7M22 18V3" />
          </svg>
        </div>
        <h2 className="mt-4 text-base font-black tracking-[-0.02em] text-zinc-200">No active HT read</h2>
        <p className="mt-2 text-[10px] font-semibold leading-relaxed text-zinc-600">
          {unavailable
            ? "Canonical intelligence is temporarily unavailable. The provider-backed chart remains separate and no score is inferred."
            : message || `${symbol} is not part of the latest promoted Canonical decision frame.`}
        </p>
        {refreshError && (
          <p className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.045] px-3 py-2 text-[9px] font-semibold leading-relaxed text-amber-200/70" role="status">
            Read refresh failed; no newer intelligence was substituted. {refreshError}
          </p>
        )}
        <div className="mt-4 rounded-xl border border-white/[0.055] bg-black/30 px-3 py-3">
          <p className="text-[7px] font-black uppercase tracking-[0.15em] text-zinc-700">What this means</p>
          <p className="mt-1.5 text-[9px] font-semibold leading-relaxed text-zinc-600">You can research any Massive-supported stock or ETF here. HT Labs only displays a Canonical or bounded ProX Market Pulse read when one actually exists.</p>
          <p className="mt-2 font-mono text-[8px] font-semibold text-zinc-700">Chart provider frame {formatEt(chartAsOf)}</p>
        </div>
      </section>
    );
  }

  const prox = opportunity.proxIntelligence;
  const pulse = prox?.pulse;
  const canonicalAsOf = decisionFrame?.decisionAsOf ?? null;
  const proxMarketAsOf = pulse?.marketAsOf ?? null;
  const proxComputedAt = pulse?.computedAt ?? prox?.asOf ?? null;
  const canonicalLane = canonicalLaneLabel(
    opportunity.strategy ?? (opportunity.isBeforeCrowd ? "before_the_crowd" : "spot_momentum"),
  );
  const canonicalFreshness = describeCanonicalOpportunityFreshness({
    frame: decisionFrame,
    decisionQuoteAsOf: opportunity.decisionQuoteAsOf,
    nowMs,
    marketActive,
  });
  const proxFreshness = describeWorkspaceReadFreshness({
    timestamp: proxMarketAsOf,
    nowMs,
    marketActive,
    providerFresh: pulse ? pulse.fresh : false,
    providerAligned: opportunity.proxMarketDataAligned,
    freshMaxAgeSeconds: 360,
    staleAfterSeconds: 900,
  });
  const proxHasBoundedAuthority = opportunity.proxMarketDataAligned === true &&
    proxFreshness.state === "fresh";

  return (
    <div
      className="space-y-4"
      data-ht-read="active"
      data-canonical-lane={opportunity.strategy ?? "unknown"}
      data-canonical-as-of={canonicalAsOf ?? ""}
      data-prox-as-of={proxMarketAsOf ?? ""}
      data-prox-aligned={String(opportunity.proxMarketDataAligned ?? "unknown")}
      data-chart-as-of={chartAsOf ?? ""}
    >
      {refreshError && (
        <p className="rounded-xl border border-amber-400/15 bg-amber-500/[0.045] px-3 py-2 text-[9px] font-semibold leading-relaxed text-amber-200/70" role="status">
          Read refresh failed; the last recorded intelligence remains visible. {refreshError}
        </p>
      )}

      <section className="overflow-hidden rounded-2xl border border-violet-400/[0.12] bg-[linear-gradient(150deg,rgba(139,92,246,0.055),rgba(0,0,0,0)_55%)]">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-300">{canonicalLane}</p>
            <h2 className="mt-1.5 text-sm font-black leading-tight text-zinc-100">{opportunity.stageEmoji} {opportunity.stage}</h2>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-black tracking-[-0.04em] text-emerald-400">{Math.round(opportunity.opportunityScore)}</p>
            <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-700">HT score</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          <Metric label="Confidence" value={`${Math.round(opportunity.confidence)}%`} tone="violet" />
          <Metric label="Relative volume" value={`${opportunity.relativeVolume.toFixed(1)}x`} tone="positive" />
        </div>
        <div className="border-t border-white/[0.055] px-4 py-3.5">
          <p className="text-[7px] font-black uppercase tracking-[0.15em] text-emerald-400/75">What changed</p>
          <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-zinc-400">{opportunity.whatChanged}</p>
          <p className="mt-3 text-[7px] font-black uppercase tracking-[0.15em] text-zinc-700">Why it matters</p>
          <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-zinc-500">{opportunity.whyItMatters}</p>
        </div>
        <div className="space-y-1 border-t border-white/[0.055] px-4 py-2.5">
          <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.08em] ${freshnessTone(canonicalFreshness.state)}`}>
            {canonicalFreshness.label}
          </span>
          <p className="font-mono text-[8px] font-semibold text-zinc-400">Decision market evidence {formatEt(opportunity.decisionQuoteAsOf)}</p>
          <p className="font-mono text-[8px] font-semibold text-zinc-400">Decision frame {formatEt(decisionFrame?.decisionAsOf)}</p>
          <p className="font-mono text-[8px] font-semibold text-zinc-400">Decision recorded {formatEt(opportunity.scannedAt)}</p>
          <p className="font-mono text-[8px] font-semibold text-zinc-400">Current chart frame {formatEt(chartAsOf)}</p>
        </div>
      </section>

      {opportunity.signals.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-[8px] font-black uppercase tracking-[0.17em] text-zinc-600">Evidence</h3>
            <span className="text-[7px] font-bold uppercase tracking-[0.1em] text-zinc-700">Read only</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {opportunity.signals.slice(0, 6).map((signal) => (
              <span key={signal} className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-[8px] font-bold text-zinc-500">{signal}</span>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-cyan-400/[0.11] bg-cyan-500/[0.025]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-4 py-3.5">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">ProX Market Pulse</p>
            <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.1em] text-zinc-600">
              {proxHasBoundedAuthority
                ? "Bounded Canonical input · no execution"
                : opportunity.proxMarketDataAligned === false
                  ? "Observational · timestamp misaligned · no execution"
                  : opportunity.proxMarketDataAligned === true
                    ? "Observational · stale provider evidence · no execution"
                    : "Observational only · alignment unavailable · no execution"}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.08em] ${freshnessTone(proxFreshness.state)}`}>
            {pulse ? proxFreshness.label : "No pulse"}
          </span>
        </div>
        {prox ? (
          <>
            <div className="grid grid-cols-2 gap-2 p-3">
              <Metric label="Tape state" value={pulse?.state ? titleCase(pulse.state) : "No market pulse"} />
              <Metric label="Market confirmation" value={`${Math.round(prox.scores.marketConfirmation)} / 100`} tone="positive" />
            </div>
            {(prox.supportFlags.length > 0 || prox.riskFlags.length > 0) && (
              <div className="border-t border-white/[0.055] px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {prox.supportFlags.slice(0, 4).map((flag) => (
                    <span key={flag} className="rounded-full border border-cyan-400/15 bg-cyan-500/[0.055] px-2 py-1 text-[7px] font-black uppercase tracking-[0.08em] text-cyan-300/80">{titleCase(flag)}</span>
                  ))}
                  {prox.riskFlags.slice(0, 3).map((flag) => (
                    <span key={flag} className="rounded-full border border-orange-400/15 bg-orange-500/[0.05] px-2 py-1 text-[7px] font-black uppercase tracking-[0.08em] text-orange-300/75">{titleCase(flag)}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="border-t border-white/[0.055] px-4 py-2.5">
              <p className="font-mono text-[8px] font-semibold text-zinc-400">ProX provider evidence {formatEt(proxMarketAsOf)}</p>
              <p className="mt-1 font-mono text-[8px] font-semibold text-zinc-400">ProX computed {formatEt(proxComputedAt)}</p>
            </div>
          </>
        ) : (
          <p className="px-4 py-5 text-[10px] font-semibold leading-relaxed text-zinc-600">No bounded ProX Market Pulse is attached to this Canonical read.</p>
        )}
      </section>

      <div className="rounded-xl border border-white/[0.055] bg-white/[0.018] px-3 py-3">
        <p className="text-[7px] font-black uppercase tracking-[0.14em] text-zinc-700">Authority stays separate</p>
        <ul className="mt-1.5 space-y-1 text-[9px] font-semibold leading-relaxed text-zinc-400">
          <li>Canonical → {canonicalLane} owns this detection and ranking.</li>
          <li>ProX Market Pulse → {proxHasBoundedAuthority ? "bounded support/warn evidence shown above" : "observational evidence only in this frame"}.</li>
          <li>Independent ProX Edge → separate shadow research; not loaded here.</li>
          <li>Agent X → separate decision/risk system; no order is placed here.</li>
        </ul>
      </div>
    </div>
  );
}
