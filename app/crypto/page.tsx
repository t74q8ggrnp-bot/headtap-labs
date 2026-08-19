"use client";

import { useRef, useState, type TouchEvent } from "react";
import type { CryptoOpportunity } from "@/lib/crypto/contracts";
import { useCryptoOpportunityFeed } from "@/app/hooks/useCryptoOpportunityFeed";
import CryptoProxPulse from "@/app/components/crypto/CryptoProxPulse";

const PULL_REFRESH_THRESHOLD = 64;

const money = (value: number) => {
  const maximumFractionDigits =
    value < 0.0001 ? 10 : value < 0.01 ? 8 : value < 1 ? 6 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
};

const compactMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3">
      <p className="text-[9px] font-black uppercase tracking-[0.17em] text-zinc-600">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-black text-zinc-200">
        {value}
      </p>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-500/[0.07] shadow-[0_0_32px_rgba(34,211,238,0.08)]">
      <span className="font-mono text-3xl font-black text-cyan-300">
        {score}
      </span>
      <span className="text-[7px] font-black uppercase tracking-[0.16em] text-cyan-600">
        Crypto score
      </span>
    </div>
  );
}

function Hero({ opportunity }: { opportunity: CryptoOpportunity }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.08] via-black to-violet-500/[0.05]">
      <div className="border-b border-white/8 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300">
              Crypto Momentum Leader
            </p>
          </div>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-500/[0.05] px-3 py-1 text-[9px] font-black uppercase tracking-[0.13em] text-cyan-400">
            Observation only
          </span>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                <h1 className="text-5xl font-black tracking-[-0.05em] text-white sm:text-7xl">
                  {opportunity.symbol}
                </h1>
                <p className="pb-1 font-mono text-xl font-black text-zinc-200">
                  {money(opportunity.price)}
                </p>
                <p className="pb-1 font-mono text-lg font-black text-green-400">
                  +{opportunity.change24hPercent.toFixed(1)}%
                </p>
              </div>
              <p className="mt-3 text-sm font-bold text-zinc-300">
                {opportunity.summary}
              </p>
            </div>
            <ScoreRing score={opportunity.opportunityScore} />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/[0.05] px-3 py-1 text-[9px] font-black uppercase text-cyan-300">
              {opportunity.stage}
            </span>
            {opportunity.riskTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-red-400/20 bg-red-500/[0.05] px-3 py-1 text-[9px] font-black uppercase text-red-300"
              >
                ⚠ {tag}
              </span>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Relative volume"
              value={`${opportunity.relativeVolume.toFixed(2)}×`}
            />
            <Metric
              label="24h liquidity"
              value={compactMoney(opportunity.dollarVolume24h)}
            />
            <Metric
              label="Below 24h high"
              value={`${opportunity.pullbackFromHighPercent.toFixed(1)}%`}
            />
            <Metric label="Risk" value={`${opportunity.riskScore}/100`} />
          </div>
          <div className="mt-4">
            <CryptoProxPulse packet={opportunity.proxIntelligence} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-black/45 p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
            Why this ranks first
          </p>
          <div className="mt-4 space-y-3">
            {Object.entries(opportunity.scoreBreakdown).map(([key, value]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.12em]">
                  <span className="text-zinc-500">
                    {key.replaceAll(/([A-Z])/g, " $1")}
                  </span>
                  <span className="font-mono text-zinc-300">{value}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[10px] font-semibold leading-4 text-zinc-600">
            One backend score combines 24-hour momentum, volume participation,
            liquidity, peak retention, multi-venue confirmation, and fresh
            ProX live-tape evidence. It is a research ranking, not a return forecast.
          </p>
        </div>
      </div>
    </section>
  );
}

function ContenderCard({
  opportunity,
  rank,
}: {
  opportunity: CryptoOpportunity;
  rank: number;
}) {
  return (
    <article className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 transition hover:border-cyan-400/20 hover:bg-cyan-500/[0.025]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-700">
            #{rank} contender
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <h2 className="text-2xl font-black text-white">
              {opportunity.symbol}
            </h2>
            <span className="font-mono text-sm font-black text-green-400">
              +{opportunity.change24hPercent.toFixed(1)}%
            </span>
          </div>
          <p className="mt-1 font-mono text-xs font-bold text-zinc-500">
            {money(opportunity.price)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-black text-cyan-300">
            {opportunity.opportunityScore}
          </p>
          <p className="text-[7px] font-black uppercase tracking-[0.14em] text-zinc-700">
            HT Crypto
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="RVOL" value={`${opportunity.relativeVolume.toFixed(1)}×`} />
        <Metric
          label="Peak pullback"
          value={`${opportunity.pullbackFromHighPercent.toFixed(1)}%`}
        />
        <Metric label="Risk" value={`${opportunity.riskScore}`} />
      </div>
      <p className="mt-3 text-[10px] font-bold text-zinc-600">
        {opportunity.stage} · {compactMoney(opportunity.dollarVolume24h)} traded
        {opportunity.proxIntelligence
          ? ` · ProX ${opportunity.proxIntelligence.state}`
          : ""}
        {opportunity.sourceVenues.length > 1
          ? ` · ${opportunity.sourceVenues.length} venues`
          : ""}
      </p>
    </article>
  );
}

export default function CryptoPage() {
  const { feed, error, loading, refresh } = useCryptoOpportunityFeed();
  const touchStartY = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const updatePullDistance = (distance: number) => {
    pullDistanceRef.current = distance;
    setPullDistance(distance);
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (window.scrollY > 0 || refreshing || event.touches.length !== 1) return;
    touchStartY.current = event.touches[0].clientY;
  };

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    if (touchStartY.current === null || event.touches.length !== 1) return;
    const rawDistance = event.touches[0].clientY - touchStartY.current;
    updatePullDistance(Math.min(96, Math.max(0, rawDistance * 0.45)));
  };

  const handleTouchEnd = () => {
    touchStartY.current = null;
    if (pullDistanceRef.current < PULL_REFRESH_THRESHOLD || refreshing) {
      updatePullDistance(0);
      return;
    }

    setRefreshing(true);
    updatePullDistance(48);
    void refresh().finally(() => {
      setRefreshing(false);
      updatePullDistance(0);
    });
  };

  return (
    <main
      className="min-h-screen bg-[#050606] text-white"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+0.55rem)] z-[550] flex -translate-x-1/2 items-center gap-2 rounded-full border border-cyan-400/20 bg-[#071014]/95 px-3 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-300 shadow-xl backdrop-blur-xl transition-[opacity,transform] duration-200"
        style={{
          opacity: pullDistance > 4 || refreshing ? 1 : 0,
          transform: `translate(-50%, ${Math.max(-52, pullDistance - 52)}px)`,
        }}
        role="status"
        aria-live="polite"
      >
        <span className={refreshing ? "animate-spin text-sm" : "text-sm"}>↻</span>
        {refreshing
          ? "Refreshing crypto"
          : pullDistance >= PULL_REFRESH_THRESHOLD
            ? "Release to refresh"
            : "Pull to refresh"}
      </div>

      <div
        className="mx-auto max-w-7xl px-4 py-5 transition-transform duration-200 sm:px-6 lg:px-8"
        style={{ transform: `translateY(${pullDistance * 0.18}px)` }}
      >


        {loading && !feed ? (
          <div className="rounded-3xl border border-white/8 bg-white/[0.02] px-6 py-28 text-center">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-zinc-600">
              Scanning Coinbase USD markets
            </p>
          </div>
        ) : error && !feed ? (
          <div className="rounded-3xl border border-red-400/20 bg-red-500/[0.04] px-6 py-20 text-center">
            <p className="font-black text-red-300">Crypto preview unavailable</p>
            <p className="mt-2 text-sm text-zinc-600">{error}</p>
          </div>
        ) : feed ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700">
                {feed.diagnostics.evaluatedProducts} scored · {feed.diagnostics.eligibleProducts} eligible · {feed.diagnostics.shadowDiscoveryAssets} assets watched across {feed.diagnostics.shadowDiscoveryHealthyVenues} venues
              </p>
              <p className="text-[9px] font-semibold text-zinc-700">
                {feed.decisionFrame.fresh ? "Verified" : "Last verified"} {new Date(feed.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>

            {!feed.decisionFrame.fresh && (
              <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.04] px-4 py-3 text-xs font-bold text-amber-300">
                The latest atomic crypto frame has expired. HT is showing radar
                context only until the next verified backend cycle completes.
              </div>
            )}

            {feed.hero ? (
              <Hero opportunity={feed.hero} />
            ) : (
              <div className="rounded-3xl border border-amber-400/20 bg-amber-500/[0.04] px-6 py-20 text-center">
                <p className="font-black text-amber-300">No confirmed crypto leader</p>
                <p className="mt-2 text-sm text-zinc-600">
                  HT will not force a hero when no asset clears every gate.
                </p>
              </div>
            )}

            <section className="mt-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                  Backup contenders
                </h2>
                <span className="text-[9px] font-semibold text-zinc-700">
                  Same score · same scan
                </span>
              </div>
              {feed.contenders.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {feed.contenders.map((opportunity, index) => (
                    <ContenderCard
                      key={opportunity.productId}
                      opportunity={opportunity}
                      rank={index + 2}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 text-sm font-semibold text-zinc-600">
                  No additional assets clear the confirmation gates right now.
                </p>
              )}
            </section>

            <section className="mt-5 rounded-3xl border border-violet-400/15 bg-violet-500/[0.025] p-5">
              <h2 className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">
                Crypto Momentum Radar
              </h2>
              <p className="mt-1 text-[10px] font-semibold text-zinc-600">
                Movement worth monitoring that has not cleared every hero gate.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {feed.radar.length > 0 ? (
                  feed.radar.map((opportunity) => (
                    <div
                      key={opportunity.productId}
                      className="flex items-center justify-between rounded-xl border border-white/8 bg-black/40 px-4 py-3"
                    >
                      <div>
                        <p className="font-black text-white">{opportunity.symbol}</p>
                        <p className="font-mono text-[10px] font-bold text-green-400">
                          +{opportunity.change24hPercent.toFixed(1)}% · {opportunity.relativeVolume.toFixed(1)}×
                        </p>
                      </div>
                      <p className="font-mono text-2xl font-black text-violet-300">
                        {opportunity.opportunityScore}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm font-semibold text-zinc-700">
                    Radar is clear right now.
                  </p>
                )}
              </div>
            </section>

            <footer className="py-6 text-center text-[9px] font-semibold text-zinc-800">
              Research preview only. Crypto markets trade continuously and can
              move sharply. Rankings are observational, not financial advice.
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
