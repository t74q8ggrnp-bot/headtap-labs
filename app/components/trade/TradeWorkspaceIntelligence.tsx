"use client";

import type { Opportunity } from "@/lib/opportunity-model";

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
  loading,
  unavailable,
  message,
}: {
  symbol: string;
  opportunity: Opportunity | null;
  loading: boolean;
  unavailable: boolean;
  message: string | null;
}) {
  if (loading) return <LoadingRead />;

  if (!opportunity) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.018] p-4" data-ht-read="none">
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
        <div className="mt-4 rounded-xl border border-white/[0.055] bg-black/30 px-3 py-3">
          <p className="text-[7px] font-black uppercase tracking-[0.15em] text-zinc-700">What this means</p>
          <p className="mt-1.5 text-[9px] font-semibold leading-relaxed text-zinc-600">You can research any Massive-supported stock or ETF here. HT Labs only displays a Canonical or ProX read when one actually exists.</p>
        </div>
      </section>
    );
  }

  const prox = opportunity.proxIntelligence;
  const pulse = prox?.pulse;
  const canonicalAsOf = opportunity.displayQuoteAsOf || opportunity.scannedAt;
  const proxAsOf = pulse?.marketAsOf || pulse?.computedAt || prox?.asOf;

  return (
    <div
      className="space-y-4"
      data-ht-read="active"
      data-canonical-as-of={canonicalAsOf ?? ""}
      data-prox-as-of={proxAsOf ?? ""}
    >
      <section className="overflow-hidden rounded-2xl border border-violet-400/[0.12] bg-[linear-gradient(150deg,rgba(139,92,246,0.055),rgba(0,0,0,0)_55%)]">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-300">Canonical read</p>
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
        <div className="border-t border-white/[0.055] px-4 py-2.5">
          <p className="font-mono text-[8px] font-semibold text-zinc-700">Canonical as of {formatEt(canonicalAsOf)}</p>
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
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">ProX market read</p>
            <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.1em] text-zinc-600">Independent research · no execution</p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.1em] ${pulse?.fresh ? "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300" : "border-white/[0.07] bg-white/[0.025] text-zinc-600"}`}>
            {pulse?.fresh ? "Fresh" : prox?.status ? titleCase(prox.status) : "No pulse"}
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
              <p className="font-mono text-[8px] font-semibold text-zinc-700">ProX provider evidence {formatEt(proxAsOf)}</p>
            </div>
          </>
        ) : (
          <p className="px-4 py-5 text-[10px] font-semibold leading-relaxed text-zinc-600">No independent ProX packet is attached to this Canonical read.</p>
        )}
      </section>

      <div className="rounded-xl border border-white/[0.055] bg-white/[0.018] px-3 py-3">
        <p className="text-[7px] font-black uppercase tracking-[0.14em] text-zinc-700">Authority stays separate</p>
        <p className="mt-1.5 text-[9px] font-semibold leading-relaxed text-zinc-600">The workspace displays existing Canonical and ProX evidence. It does not recalculate scores, create a trade signal, or place an order.</p>
      </div>
    </div>
  );
}
