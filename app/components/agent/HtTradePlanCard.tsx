import type { HtTradePlan } from "@/lib/ht-agent/contracts";

const money = (value: number | null) => value === null
  ? "Not measurable"
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
  if (status === "wait" || status === "reduce") {
    return "border-orange-400/25 bg-orange-500/[0.055] text-orange-300";
  }
  if (status === "exit" || status === "avoid") {
    return "border-red-400/25 bg-red-500/[0.055] text-red-300";
  }
  return "border-zinc-500/20 bg-zinc-500/[0.04] text-zinc-400";
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
    : "Withheld";
  const target = plan.targetTwo !== null
    ? `${money(plan.targetOne)} / ${money(plan.targetTwo)}`
    : money(plan.targetOne);

  return (
    <section className={`overflow-hidden rounded-2xl border ${tone(plan.status)}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 border-b border-white/8 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.24em] text-cyan-300">HT Trade Plan · Paper Research</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <strong className={`${compact ? "text-lg" : "text-2xl"} font-black tracking-tight`}>{plan.statusLabel}</strong>
            {!current && <span className="rounded-full border border-zinc-500/20 px-2 py-0.5 text-[8px] font-black uppercase text-zinc-500">Prior session</span>}
            {plan.executionLocked && <span className="rounded-full border border-red-400/20 px-2 py-0.5 text-[8px] font-black uppercase text-red-300">Execution locked</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">Chase risk</p>
          <p className="mt-1 text-[10px] font-black uppercase">{plan.chaseRisk}</p>
        </div>
      </div>

      <div className={`${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <p className={`${compact ? "text-xs" : "text-sm"} font-bold leading-5 text-zinc-200`}>{plan.summary}</p>
        <div className={`mt-4 grid ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"} gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8`}>
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
        <div className="mt-3 flex items-center justify-between border-b border-white/8 pb-3 text-[10px]">
          <span className="font-bold text-zinc-600">Modeled R/R</span>
          <strong className="font-mono text-violet-300">{plan.riskReward === null ? "Not measurable" : `${plan.riskReward.toFixed(2)}:1`}</strong>
        </div>
        <div className={`mt-3 grid ${compact ? "gap-3" : "gap-4 sm:grid-cols-2"}`}>
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-emerald-300">Why now</p>
            <p className="mt-1.5 text-[10px] font-semibold leading-4 text-zinc-500">{plan.whyNow}</p>
          </div>
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-red-300">Why it could fail</p>
            <p className="mt-1.5 text-[10px] font-semibold leading-4 text-zinc-500">{plan.whyCouldLose}</p>
          </div>
        </div>
        {!compact && (
          <div className="mt-4 grid gap-3 border-t border-white/8 pt-4 sm:grid-cols-2">
            <div><p className="text-[8px] font-black uppercase tracking-wider text-zinc-700">What confirms</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">{plan.whatConfirms}</p></div>
            <div><p className="text-[8px] font-black uppercase tracking-wider text-zinc-700">What invalidates</p><p className="mt-1 text-[10px] leading-4 text-zinc-500">{plan.whatInvalidates}</p></div>
          </div>
        )}
        <p className="mt-4 text-[8px] font-semibold text-zinc-700">Paper simulation and research framework only. This is not a live brokerage instruction.</p>
      </div>
    </section>
  );
}
