import type { ExplosionAssessment } from "@/lib/canonical-opportunity";

type PriceDiscoveryWindowProps = {
  assessment: ExplosionAssessment;
  compact?: boolean;
};

const pctRange = (range: { min: number; max: number }) =>
  `+${range.min.toFixed(1)}% to +${range.max.toFixed(1)}%`;

export default function PriceDiscoveryWindow({
  assessment,
  compact = false,
}: PriceDiscoveryWindowProps) {
  const scenarios = assessment.scenarioBands;
  if (!scenarios) {
    if (!compact) return null;
    return (
      <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.04] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-400">
            Price Discovery
          </p>
          <p className="font-mono text-sm font-black text-violet-300">
            {assessment.score}/100
          </p>
        </div>
        <p className="mt-2 text-[10px] font-semibold leading-4 text-zinc-500">
          {assessment.summary}
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="overflow-hidden rounded-xl border border-violet-400/20 bg-violet-500/[0.035]">
        <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-400">
              Price Discovery
            </p>
            <span className="rounded-full border border-orange-400/20 px-2 py-0.5 text-[7px] font-black uppercase text-orange-300">
              Scenario-based
            </span>
          </div>
          <p className="font-mono text-sm font-black text-violet-300">
            {assessment.score}/100
          </p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-white/6">
          <CompactValue
            label="Expansion"
            value={pctRange(scenarios.expansion)}
            tone="text-green-400"
          />
          <CompactValue
            label="Risk"
            value={
              scenarios.structuralRisk !== null
                ? `-${scenarios.structuralRisk.toFixed(1)}%`
                : "Unmeasured"
            }
            tone={scenarios.structuralRisk !== null ? "text-red-400" : "text-zinc-500"}
          />
          <CompactValue
            label="Scenario R/R"
            value={
              scenarios.expansionRr !== null
                ? `${scenarios.expansionRr.toFixed(1)}:1`
                : "Unmeasured"
            }
            tone={scenarios.expansionRr !== null ? "text-violet-400" : "text-zinc-500"}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/6 px-3.5 py-2.5">
          <p className="text-[8px] font-bold text-zinc-600">
            Base <span className="font-mono text-zinc-300">{pctRange(scenarios.base)}</span>
          </p>
          <p className="text-[8px] font-bold text-zinc-600">
            Tail <span className="font-mono text-orange-300">{pctRange(scenarios.tail)}</span>
          </p>
          <p className="ml-auto text-[7px] font-semibold italic text-zinc-700">
            Conditional ranges, not targets
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-violet-400/20 bg-black/60">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-2.5">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-400">
          Price Discovery Window
        </p>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-orange-400/25 bg-orange-500/[0.06] px-2 py-0.5 text-[8px] font-black uppercase text-orange-300">
            Scenario-based
          </span>
          <span className="text-[8px] font-semibold text-zinc-600">
            Additional from current price
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/6">
        <Value
          label="Expansion Upside"
          value={pctRange(scenarios.expansion)}
          tone="text-green-400"
        />
        <Value
          label="Structural Risk"
          value={
            scenarios.structuralRisk !== null
              ? `-${scenarios.structuralRisk.toFixed(1)}%`
              : "Not yet measurable"
          }
          tone={scenarios.structuralRisk !== null ? "text-red-400" : "text-zinc-500"}
        />
        <Value
          label="Scenario R/R"
          value={
            scenarios.expansionRr !== null
              ? `${scenarios.expansionRr.toFixed(1)}:1`
              : "Not yet measurable"
          }
          tone={scenarios.expansionRr !== null ? "text-violet-400" : "text-zinc-500"}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-white/6 px-4 py-3">
        <Scenario
          label="Base continuation"
          value={pctRange(scenarios.base)}
        />
        <Scenario
          label="Tail expansion"
          value={pctRange(scenarios.tail)}
          tail
        />
      </div>

      <div className="border-t border-white/6 bg-white/[0.01] px-4 py-3">
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600">
          Model backing
        </p>
        <p className="mt-1 text-[10px] font-semibold leading-4 text-zinc-500">
          {scenarios.inputs.atrPercent.toFixed(1)}% ATR · +
          {scenarios.inputs.currentMovePercent.toFixed(1)}% live impulse ·{" "}
          {scenarios.inputs.relativeVolume.toFixed(1)}× RVOL ·{" "}
          {scenarios.inputs.momentumScore} momentum ·{" "}
          {scenarios.inputs.explosionScore} explosion
        </p>
        <p className="mt-1 text-[9px] font-semibold italic leading-4 text-zinc-700">
          Recalculated from observed conditions. Tail expansion is a
          conditional scenario, not a promised target.
        </p>
      </div>
    </div>
  );
}

function CompactValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 px-2.5 py-3">
      <p className="truncate text-[7px] font-black uppercase tracking-[0.1em] text-zinc-600">
        {label}
      </p>
      <p className={`mt-1.5 font-mono text-xs font-black leading-tight ${tone}`}>
        {value}
      </p>
    </div>
  );
}

function Value({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 px-3 py-4">
      <p className="mb-2 truncate text-[8px] font-black uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </p>
      <p
        className={`font-mono text-base font-black leading-tight ${tone}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function Scenario({
  label,
  value,
  tail = false,
}: {
  label: string;
  value: string;
  tail?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tail
          ? "border-orange-400/15 bg-orange-500/[0.04]"
          : "border-white/6 bg-white/[0.02]"
      }`}
    >
      <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-xs font-black ${
          tail ? "text-orange-300" : "text-zinc-300"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
