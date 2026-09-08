import Image from "next/image";
import type { HtTradePlan } from "@/lib/ht-agent/contracts";

const money = (value: number | null) => value === null
  ? "Not formed"
  : new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);

function tone(status: HtTradePlan["status"]) {
  if (status === "paper_entry_eligible" || status === "manage") {
    return "border-emerald-400/25 bg-emerald-500/[0.055] text-emerald-300";
  }
  if (status === "reduce" || status === "exit") {
    return "border-orange-400/25 bg-orange-500/[0.055] text-orange-300";
  }
  if (status === "wait" || status === "avoid") {
    return "border-violet-400/25 bg-violet-500/[0.045] text-violet-300";
  }
  return "border-cyan-400/20 bg-cyan-500/[0.035] text-cyan-300";
}

function publicStatus(plan: HtTradePlan) {
  if (plan.status === "wait" || plan.status === "avoid") return "SETUP FORMING";
  if (plan.status === "unavailable") return "UPDATING MARKET EVIDENCE";
  return plan.statusLabel;
}

function activityLabel(status: HtTradePlan["status"]) {
  if (status === "wait" || status === "avoid") return "Monitoring live conditions";
  if (status === "unavailable") return "Refreshing the aligned decision frame";
  if (status === "paper_entry_eligible") return "Paper framework ready";
  if (status === "manage") return "Paper position active";
  if (status === "reduce") return "Paper profit-management state";
  return "Paper position-management state";
}

export default function HtTradePlanCard({
  plan,
  current = true,
  compact = false,
}: {
  plan: HtTradePlan;
  current?: boolean;
  compact?: boolean;
}) {
  const entry = plan.entryZone
    ? `${money(plan.entryZone.low)}–${money(plan.entryZone.high)}`
    : "Not formed";
  const target = plan.targetTwo !== null
    ? `${money(plan.targetOne)} / ${money(plan.targetTwo)}`
    : money(plan.targetOne);

  return (
    <section className={`overflow-hidden rounded-2xl border ${tone(plan.status)}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-white/8 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-black/30">
            <Image src="/logo.png" alt="" width={2909} height={1959} className="h-7 w-auto object-contain" />
          </span>
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase tracking-[0.24em] text-cyan-300">HT Agent · Paper Research</p>
            <strong className={`${compact ? "text-base" : "text-xl"} mt-1 block font-black tracking-tight text-white`}>{publicStatus(plan)}</strong>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!current && <span className="rounded-full border border-zinc-500/20 px-2.5 py-1 text-[8px] font-black uppercase text-zinc-500">Prior session</span>}
          <span className="rounded-full border border-cyan-400/15 bg-cyan-500/[0.04] px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-cyan-300">
            {plan.executionLocked ? "Research mode" : "Paper only"}
          </span>
        </div>
      </div>

      <div className={`${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-[1.25fr_.75fr] lg:items-start"}`}>
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-600">Current read</p>
            <p className={`${compact ? "text-xs" : "text-sm"} mt-1.5 font-bold leading-5 text-zinc-200`}>{plan.summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/8 bg-black/25 px-3 py-2.5">
              <p className="text-[7px] font-black uppercase tracking-wider text-zinc-600">Activity</p>
              <p className="mt-1 text-[9px] font-black text-zinc-300">{activityLabel(plan.status)}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-black/25 px-3 py-2.5">
              <p className="text-[7px] font-black uppercase tracking-wider text-zinc-600">Market heat</p>
              <p className="mt-1 text-[9px] font-black uppercase text-zinc-300">{plan.chaseRisk}</p>
            </div>
          </div>
        </div>

        <div className={`mt-3 grid ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"} gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8`}>
          {[
            ["Paper entry", entry],
            ["Confirmation", money(plan.confirmationTrigger)],
            ["Invalidation", money(plan.invalidation)],
            ["Targets", target],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#07090a] px-3 py-3">
              <p className="text-[7px] font-black uppercase tracking-wider text-zinc-700">{label}</p>
              <p className="mt-1 font-mono text-[10px] font-black text-zinc-300">{value}</p>
            </div>
          ))}
        </div>
        <details className="group mt-3 rounded-xl border border-white/8 bg-black/20">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500 marker:hidden">
            View reasoning and levels
            <span className="text-violet-300 transition-transform group-open:rotate-45">＋</span>
          </summary>
          <div className={`grid gap-3 border-t border-white/8 px-3 py-3 ${compact ? "" : "sm:grid-cols-2"}`}>
            <div><p className="text-[8px] font-black uppercase tracking-wider text-emerald-300">Why it is moving</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">{plan.whyNow}</p></div>
            <div><p className="text-[8px] font-black uppercase tracking-wider text-violet-300">Risk context</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">{plan.whyCouldLose}</p></div>
            <div><p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">What confirms the setup</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">{plan.whatConfirms}</p></div>
            <div><p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">What changes the read</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">{plan.whatInvalidates}</p></div>
            <div className="flex items-center justify-between border-t border-white/8 pt-3 text-[10px] sm:col-span-2">
              <span className="font-bold text-zinc-600">Modeled R/R</span>
              <strong className="font-mono text-violet-300">{plan.riskReward === null ? "Pending" : `${plan.riskReward.toFixed(2)}:1`}</strong>
            </div>
            <p className="text-[8px] font-semibold text-zinc-700 sm:col-span-2">Paper simulation and research framework only. This is not a live brokerage instruction.</p>
          </div>
        </details>
      </div>
    </section>
  );
}
