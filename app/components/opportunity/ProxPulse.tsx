import type { ProxIntelligencePacket } from "@/lib/prox/intelligence";

type ProxPulseProps = {
  packet: ProxIntelligencePacket;
};

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function ProxPulse({ packet }: ProxPulseProps) {
  const hasEvent = packet.event !== null;
  const pulse = packet.pulse;
  const visibleFlags = [...packet.supportFlags, ...packet.riskFlags].slice(0, 4);

  return (
    <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300">
            ProX Pulse
          </p>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
            Shadow intelligence · no execution authority
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${
            packet.status === "active"
              ? "border-green-400/20 text-green-400"
              : packet.status === "stale_pulse"
                ? "border-amber-400/20 text-amber-300"
                : "border-white/10 text-zinc-500"
          }`}
        >
          {label(packet.status)}
        </span>
      </div>

      {hasEvent ? (
        <>
          <p className="mt-3 text-[11px] font-semibold leading-5 text-zinc-400">
            {packet.event?.headline ?? label(packet.event?.catalystCategory ?? "unclassified")}
          </p>
          <div className="mt-3 grid grid-cols-3 divide-x divide-white/[0.06] rounded-lg border border-white/[0.06] bg-black/20 py-2.5">
            <div className="px-3">
              <p className="font-mono text-base font-black text-cyan-300">
                {packet.scores.evidenceConfidence.toFixed(0)}
              </p>
              <p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">
                Evidence
              </p>
            </div>
            <div className="px-3">
              <p className="font-mono text-base font-black text-violet-300">
                {packet.scores.marketConfirmation.toFixed(0)}
              </p>
              <p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">
                Market
              </p>
            </div>
            <div className="px-3">
              <p className="font-mono text-base font-black text-white">
                {packet.scores.composite.toFixed(0)}
              </p>
              <p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">
                Composite
              </p>
            </div>
          </div>
          {pulse && (
            <p className="mt-2 text-[9px] font-semibold leading-4 text-zinc-600">
              {pulse.velocity1m === null ? "—" : `${pulse.velocity1m >= 0 ? "+" : ""}${pulse.velocity1m.toFixed(2)}%`} 1m
              {" · "}
              {pulse.acceleration5m === null ? "—" : `${pulse.acceleration5m >= 0 ? "+" : ""}${pulse.acceleration5m.toFixed(2)}%`} 5m
              {" · "}
              {pulse.volumeAcceleration === null ? "—" : `${pulse.volumeAcceleration.toFixed(1)}×`} volume
              {" · "}
              {pulse.priceVsVwap === null ? "—" : `${pulse.priceVsVwap >= 0 ? "+" : ""}${pulse.priceVsVwap.toFixed(2)}%`} vs VWAP
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-[10px] font-semibold leading-4 text-zinc-500">
          No recent ProX evidence is attached. Absence of evidence does not
          penalize the canonical opportunity.
        </p>
      )}

      {visibleFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleFlags.map((flag) => (
            <span
              key={flag}
              className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${
                packet.riskFlags.includes(flag)
                  ? "border-red-400/20 text-red-300"
                  : "border-cyan-400/15 text-cyan-400"
              }`}
            >
              {label(flag)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

