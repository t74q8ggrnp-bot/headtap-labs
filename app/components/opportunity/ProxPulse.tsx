import type { ProxIntelligencePacket } from "@/lib/prox/intelligence";

type ProxPulseProps = {
  packet: ProxIntelligencePacket;
};

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function ProxPulse({ packet }: ProxPulseProps) {
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
            {pulse
              ? "Bounded live-tape authority · no execution"
              : "Research intelligence · no execution"}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${
            packet.status === "active" || packet.status === "market_only"
              ? "border-green-400/20 text-green-400"
              : packet.status === "stale_pulse"
                ? "border-amber-400/20 text-amber-300"
                : "border-white/10 text-zinc-500"
          }`}
        >
          {label(packet.status)}
        </span>
      </div>

      {packet.event && (
        <p className="mt-3 text-[11px] font-semibold leading-5 text-zinc-400">
          {packet.event.headline ?? label(packet.event.catalystCategory)}
        </p>
      )}

      {pulse ? (
        <>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
            <p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">
              Live read
            </p>
            <p className={`text-[10px] font-black uppercase ${pulse.state === "expanding" ? "text-green-400" : pulse.state === "weakening" ? "text-red-300" : pulse.state === "stale" ? "text-amber-300" : "text-cyan-300"}`}>
              {label(pulse.state)}
            </p>
          </div>
          <p className="mt-2 text-[9px] font-semibold leading-4 text-zinc-600">
            ProX correlated short-term velocity, acceleration, volume behavior,
            and VWAP position into the single HT opportunity decision above.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[10px] font-semibold leading-4 text-zinc-500">
          No fresh ProX market pulse is attached. Missing pulse data does not
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
