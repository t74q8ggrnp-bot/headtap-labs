import Link from "next/link";
import type { CryptoOpportunityFeed } from "@/lib/crypto/contracts";
import CryptoProxPulse from "@/app/components/crypto/CryptoProxPulse";
import HeroPriceChart from "@/app/components/market/HeroPriceChart";

type CryptoMomentumPreviewProps = {
  feed: CryptoOpportunityFeed | null;
  loading: boolean;
  error: string | null;
};

const money = (value: number) => {
  const maximumFractionDigits =
    value < 0.0001 ? 10 : value < 0.01 ? 8 : value < 1 ? 6 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
};

export default function CryptoMomentumPreview({
  feed,
  loading,
  error,
}: CryptoMomentumPreviewProps) {
  const confirmedHero = feed?.hero ?? null;
  const hero = confirmedHero ?? feed?.developingLeader ?? null;
  const developing = !confirmedHero && Boolean(feed?.developingLeader);
  const contenders = feed?.contenders ?? [];
  const radar = feed?.radar ?? [];
  const radarSlots = contenders.length === 0 ? 5 : Math.max(0, 4 - contenders.length);
  const visibleRadar = radar.slice(0, radarSlots);

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-cyan-400/15 bg-gradient-to-br from-cyan-500/[0.06] via-[#030708] to-violet-500/[0.035]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 md:px-5">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">
              24/7 Crypto Momentum
            </p>
            <p className="mt-0.5 text-[9px] font-semibold text-zinc-600">
              One HT score · centralized-exchange discovery · ProX live-tape
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {feed && (
            <span className="text-[9px] font-semibold text-zinc-700">
              {feed.diagnostics.evaluatedProducts} evaluated · {feed.diagnostics.eligibleProducts} eligible
            </span>
          )}
          <Link
            href="/crypto"
            className="rounded-full border border-cyan-400/20 bg-cyan-500/[0.06] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-300 transition hover:bg-cyan-500/[0.12]"
          >
            Open Crypto Lab →
          </Link>
        </div>
      </div>

      {loading && !feed ? (
        <div className="grid animate-pulse gap-3 p-4 md:grid-cols-[1.15fr_1fr] md:p-5">
          <div className="h-36 rounded-2xl bg-white/[0.035]" />
          <div className="h-36 rounded-2xl bg-white/[0.025]" />
        </div>
      ) : error && !feed ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-black text-zinc-300">Crypto feed temporarily unavailable</p>
          <p className="mt-1 text-[10px] font-semibold text-zinc-600">{error}</p>
        </div>
      ) : hero ? (
        <div className="grid gap-3 p-4 md:grid-cols-[1.15fr_1fr] md:p-5">
          <div className="rounded-2xl border border-cyan-400/15 bg-black/35 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.17em] text-cyan-600">
                  {developing ? "Strongest developing setup" : "Crypto leader"}
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-4xl font-black tracking-[-0.05em] text-white">
                    {hero.symbol}
                  </p>
                  <p className="font-mono text-sm font-black text-zinc-300">
                    {money(hero.price)}
                  </p>
                  <p className="font-mono text-sm font-black text-green-400">
                    +{hero.change24hPercent.toFixed(1)}%
                  </p>
                </div>
                <p className="mt-2 text-xs font-bold leading-5 text-zinc-400">
                  {hero.summary}
                </p>
                {developing && (
                  <span className="mt-2 inline-flex rounded-full border border-amber-400/20 bg-amber-500/[0.06] px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.1em] text-amber-300">
                    Entry withheld
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-4xl font-black text-cyan-300">
                  {hero.opportunityScore}
                </p>
                <p className="text-[7px] font-black uppercase tracking-[0.14em] text-cyan-700">
                  {developing ? "Radar score" : "HT Crypto"}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <HeroPriceChart
                asset="crypto"
                symbol={hero.symbol}
                productId={hero.productId}
                accent="cyan"
                compact
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Liquidity", `$${(hero.dollarVolume24h / 1_000_000).toFixed(1)}M`],
                ["Relative vol", `${hero.relativeVolume.toFixed(2)}×`],
                ["Risk", `${hero.riskScore}/100`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/7 bg-white/[0.025] px-3 py-2.5">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-700">{label}</p>
                  <p className="mt-1 font-mono text-xs font-black text-zinc-300">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <CryptoProxPulse packet={hero.proxIntelligence} compact />
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-white/8 bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[9px] font-black uppercase tracking-[0.17em] text-zinc-600">
                {contenders.length > 0 ? "Other contenders" : "Crypto momentum radar"}
              </p>
              <p className="text-[8px] font-semibold text-zinc-700">
                {contenders.length > 0 ? "Same atomic decision" : "Observation only"}
              </p>
            </div>
            <div className="space-y-1.5">
              {contenders.map((opportunity, index) => (
                <div
                  key={opportunity.productId}
                  className="flex items-center justify-between rounded-xl border border-white/7 bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-[9px] font-black text-zinc-700">#{index + 2}</span>
                    <div>
                      <p className="font-black text-white">{opportunity.symbol}</p>
                      <p className="font-mono text-[9px] font-bold text-green-400">
                        +{opportunity.change24hPercent.toFixed(1)}% · {opportunity.relativeVolume.toFixed(1)}×
                      </p>
                      {opportunity.proxIntelligence && (
                        <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-cyan-700">
                          ProX {opportunity.proxIntelligence.state}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="font-mono text-xl font-black text-cyan-300">
                    {opportunity.opportunityScore}
                  </p>
                </div>
              ))}
            </div>

            {visibleRadar.length > 0 && (
              <div className={contenders.length > 0 ? "mt-3 border-t border-white/7 pt-3" : ""}>
                {contenders.length > 0 && (
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-[8px] font-black uppercase tracking-[0.16em] text-violet-400">
                      Momentum radar
                    </p>
                    <p className="text-[7px] font-semibold uppercase tracking-[0.1em] text-zinc-700">
                      Confirmation pending
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  {visibleRadar.map((opportunity) => (
                    <div
                      key={`radar-${opportunity.productId}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-violet-400/12 bg-violet-500/[0.025] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p className="font-black text-white">{opportunity.symbol}</p>
                          <p className={`font-mono text-[9px] font-black ${opportunity.change24hPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {opportunity.change24hPercent >= 0 ? "+" : ""}{opportunity.change24hPercent.toFixed(1)}%
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-[8px] font-bold text-zinc-600">
                          {opportunity.relativeVolume.toFixed(1)}× RVOL · {opportunity.stage}
                        </p>
                        <p className="mt-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-violet-500">
                          Watched · not confirmed
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-xl font-black text-violet-300">
                          {opportunity.opportunityScore}
                        </p>
                        <p className="text-[6px] font-black uppercase tracking-[0.12em] text-zinc-700">
                          Radar score
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {contenders.length === 0 && visibleRadar.length === 0 && feed && (
              <div className="flex flex-1 flex-col justify-between rounded-xl border border-white/7 bg-white/[0.015] p-4">
                <div>
                  <p className="text-xs font-black text-zinc-300">No secondary setup is confirmed</p>
                  <p className="mt-1 text-[9px] font-semibold leading-4 text-zinc-600">
                    HT is preserving the confirmation gates instead of manufacturing a backup pick.
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    ["Evaluated", `${feed.diagnostics.evaluatedProducts}`],
                    ["Radar", `${feed.diagnostics.radarProducts}`],
                    ["ProX coverage", `${feed.diagnostics.proxAvailableProducts}/${feed.diagnostics.proxEvaluatedProducts}`],
                    ["Healthy venues", `${feed.diagnostics.shadowDiscoveryHealthyVenues}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/6 bg-black/30 px-3 py-2.5">
                      <p className="text-[7px] font-black uppercase tracking-[0.12em] text-zinc-700">{label}</p>
                      <p className="mt-1 font-mono text-sm font-black text-cyan-300">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-[8px] font-semibold text-zinc-700">
                  {feed.decisionFrame.fresh ? "Current backend cycle verified" : "Showing the last verified backend cycle"}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-black text-amber-300">No confirmed crypto leader</p>
          <p className="mt-1 text-[10px] font-semibold text-zinc-600">
            HT will not force a crypto pick when no asset clears every gate.
          </p>
        </div>
      )}
    </section>
  );
}
