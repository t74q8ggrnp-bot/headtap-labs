import type { CryptoProxPacket } from "@/lib/crypto/contracts";

type CryptoProxPulseProps = {
  packet: CryptoProxPacket | null;
  compact?: boolean;
};

const humanize = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatPercent = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function CryptoProxPulse({
  packet,
  compact = false,
}: CryptoProxPulseProps) {
  if (!packet) {
    return (
      <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.025] px-4 py-3">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-500">
          ProX Crypto Pulse
        </p>
        <p className="mt-1 text-[10px] font-semibold text-zinc-600">
          Collecting enough one-minute market structure for an honest pulse.
        </p>
      </div>
    );
  }

  const stateColor = packet.state === "expanding"
    ? "text-green-400"
    : packet.state === "weakening"
      ? "text-red-400"
      : packet.state === "stale"
        ? "text-zinc-500"
        : "text-violet-300";
  const visibleFlags = [
    ...packet.supportFlags.map((flag) => ({ flag, risk: false })),
    ...packet.riskFlags.map((flag) => ({ flag, risk: true })),
  ].slice(0, compact ? 4 : 8);

  return (
    <div className="rounded-2xl border border-cyan-400/20 bg-[#001013]/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400">
            ProX Crypto Pulse
          </p>
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
            24/7 market intelligence · shadow learning
          </p>
        </div>
        <div className="text-right">
          <p className={`text-xs font-black uppercase ${stateColor}`}>
            {packet.state}
          </p>
          <p className="mt-0.5 text-[8px] font-bold text-zinc-700">
            {packet.barCount} one-minute bars
          </p>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["5m move", formatPercent(packet.features.velocity5mPercent)],
            ["Volume pulse", packet.features.volumeAcceleration === null
              ? "—"
              : `${packet.features.volumeAcceleration.toFixed(2)}×`],
            ["Vs VWAP", formatPercent(packet.features.priceVsVwapPercent)],
            ["Vs BTC 15m", formatPercent(packet.features.btcRelativeStrength15mPercent)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/7 bg-black/25 px-3 py-2.5">
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-700">
                {label}
              </p>
              <p className="mt-1 font-mono text-xs font-black text-zinc-300">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {visibleFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleFlags.map(({ flag, risk }) => (
            <span
              key={`${risk ? "risk" : "support"}-${flag}`}
              className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                risk
                  ? "border-red-400/20 bg-red-500/[0.05] text-red-300"
                  : "border-cyan-400/20 bg-cyan-500/[0.05] text-cyan-300"
              }`}
            >
              {humanize(flag)}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-[9px] font-semibold leading-4 text-zinc-600">
        ProX is recording what it would change, but the visible HT Crypto score
        remains the single canonical score until outcome evidence validates the adjustment.
      </p>
    </div>
  );
}
