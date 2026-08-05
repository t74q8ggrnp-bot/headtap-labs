"use client";

// Extracted verbatim from app/page.tsx's "MOBILE EXPERIENCE — completely
// separate UI" block. No behavior change — same JSX, same canonical data
// sources, same handlers, now passed in as props instead of closed over.
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import type {
  DecisionTraceDisplay as DecisionTraceModel,
  BullBearAnalysis,
  MarketStock as Stock,
  TradeFrameworkDisplay as TradeFramework,
} from "@/lib/contracts/market";
import {
  getOpportunityPresentation,
  resolveOpportunityDisplayQuote,
  type LiveOpportunityQuotes,
  type Opportunity as APIOpportunity,
} from "@/lib/opportunity-model";
import OpportunityStateCard from "@/app/components/OpportunityStateCard";
import OpportunityWindow from "@/app/components/opportunity/OpportunityWindow";
import MobileBeforeCrowdCard from "@/app/components/opportunity/MobileBeforeCrowdCard";
import MobileCardDetail from "@/app/components/opportunity/MobileCardDetail";
import MobileSpotMomentumCard from "@/app/components/opportunity/MobileSpotMomentumCard";
import MobileConvictionsList from "@/app/components/opportunity/MobileConvictionsList";
import MobileWatchlist from "@/app/components/opportunity/MobileWatchlist";
import MomentumContenders from "@/app/components/opportunity/MomentumContenders";
import ProxPulse from "@/app/components/opportunity/ProxPulse";

type MobileTab = "home" | "convictions" | "scanner" | "watchlist" | "profile";

export type MobileExperienceProps = {
  ticker: string;
  setTicker: (value: string) => void;
  handleTickerSearch: () => void | Promise<void>;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  lastUpdated: Date | null;
  canonicalMobileOpportunities: APIOpportunity[];
  momentumRunnersUp: APIOpportunity[];
  liveQuotes: LiveOpportunityQuotes;
  mobileCardIndex: number;
  setMobileCardIndex: (value: number | ((index: number) => number)) => void;
  mobileTouchStart: number | null;
  setMobileTouchStart: (value: number | null) => void;
  apiOpportunitiesLoading: boolean;
  apiMomentum: APIOpportunity | null;
  smFramework: TradeFramework | null;
  smTrace: DecisionTraceModel | null;
  bullBearData: BullBearAnalysis | null;
  isDualEngineConfirmation: boolean;
  watchlist: string[];
  setSelectedStock: (stock: Stock | null) => void;
  toggleWatchlist: (symbol: string) => void;
  opportunityToStock: (opportunity: APIOpportunity) => Stock;
  apiBeforeCrowdPick: APIOpportunity | null;
  btcFramework: TradeFramework | null;
  btcTrace: DecisionTraceModel | null;
  mobileScannerReads: APIOpportunity[];
  getOtherReadState: (o: APIOpportunity) => { label: string; tone: string };
  openReadTicker: (ticker: string) => void;
  watchlistStocks: Stock[];
  session: Session | null;
  handleSignOut: () => void | Promise<void>;
  savedSetups: string[];
  signalMemoryInsight: { tracked: number; successRate: number | null } | null;
  authEmail: string;
  setAuthEmail: (value: string) => void;
  authPassword: string;
  setAuthPassword: (value: string) => void;
  handleAuth: (mode: "signin" | "signup") => void | Promise<void>;
  authLoading: boolean;
  authMessage: string;
  selectedStock: Stock | null;
  selectedOpportunity: APIOpportunity | null;
  selectedOpportunityLoading: boolean;
  selectedOpportunityPresentation: ReturnType<typeof getOpportunityPresentation> | null;
  selectedOpportunityError: string;
  selectedOpportunityFramework: TradeFramework | null;
  bullBearLoading: boolean;
  bullBearTicker: string;
};

export default function MobileExperience({
  ticker, setTicker, handleTickerSearch, mobileTab, setMobileTab, lastUpdated,
  canonicalMobileOpportunities, momentumRunnersUp, liveQuotes, mobileCardIndex, setMobileCardIndex, mobileTouchStart,
  setMobileTouchStart, apiOpportunitiesLoading, apiMomentum, smFramework, smTrace,
  bullBearData, isDualEngineConfirmation, watchlist, setSelectedStock, toggleWatchlist,
  opportunityToStock, apiBeforeCrowdPick, btcFramework, btcTrace, mobileScannerReads,
  getOtherReadState, openReadTicker, watchlistStocks, session, handleSignOut, savedSetups,
  signalMemoryInsight, authEmail, setAuthEmail, authPassword, setAuthPassword, handleAuth,
  authLoading, authMessage, selectedStock, selectedOpportunity, selectedOpportunityLoading,
  selectedOpportunityPresentation, selectedOpportunityError, selectedOpportunityFramework,
  bullBearLoading, bullBearTicker,
}: MobileExperienceProps) {
  return (
    <div className="md:hidden fixed inset-0 bg-[#050505] text-white flex flex-col z-[200]">

        {/* Mobile Header */}
        <div className="flex-shrink-0 border-b border-white/10 bg-black/80 backdrop-blur-xl px-4 pt-safe">
          <div className="flex items-center justify-between gap-3 py-3">
            <Image src="/logo.png" alt="HT Labs" width={2909} height={1959} className="h-8 w-auto" priority />
            <div className="flex-1 mx-3">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2">
                <span className="text-zinc-600 text-sm">⌕</span>
                <input
                  type="text"
                  placeholder="Search ticker..."
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") { handleTickerSearch(); setMobileTab("home"); } }}
                  className="flex-1 bg-transparent text-sm font-black uppercase text-white outline-none placeholder:normal-case placeholder:font-normal placeholder:text-zinc-600"
                />
                {ticker.length > 0 && (
                  <button
                    onClick={() => { handleTickerSearch(); setMobileTab("home"); }}
                    className="shrink-0 rounded-lg bg-violet-500/20 border border-violet-400/30 px-2.5 py-1 text-[10px] font-black text-violet-300"
                  >
                    GO
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-[0.14em] text-green-400">Live</span>
            </div>
          </div>
        </div>

        {/* Mobile content area */}
        <div className="flex-1 overflow-hidden relative">

          {/* HOME TAB — Before The Crowd + Swipeable conviction cards */}
          {mobileTab === "home" && (() => {
            // Show mobile skeleton on first load — same gate as desktop
            if (!lastUpdated) return (
              <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4 animate-pulse">
                <div className="rounded-2xl border border-white/8 bg-black overflow-hidden">
                  <div className="px-5 pt-4 pb-0 flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-400/40" />
                    <div className="h-2 w-28 rounded-full bg-white/8" />
                  </div>
                  <div className="px-5 pt-3 pb-2">
                    <div className="h-12 w-32 rounded-xl bg-white/6" />
                  </div>
                  <div className="px-5 pb-4 border-b border-white/8">
                    <div className="h-7 w-48 rounded-xl bg-white/6 mb-1.5" />
                    <div className="h-3 w-56 rounded-full bg-white/6" />
                  </div>
                  <div className="px-5 py-5 border-b border-white/8 space-y-3">
                    <div className="h-2 w-32 rounded-full bg-white/8" />
                    <div className="h-[3px] w-full rounded-full bg-white/6" />
                    <div className="flex justify-between">
                      <div className="h-8 w-12 rounded-lg bg-white/6" />
                      <div className="flex gap-4">
                        <div className="h-8 w-12 rounded-lg bg-white/6" />
                        <div className="h-8 w-12 rounded-lg bg-white/6" />
                        <div className="h-8 w-12 rounded-lg bg-white/6" />
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-4 border-b border-white/8 space-y-2">
                    <div className="h-2 w-40 rounded-full bg-white/8" />
                    <div className="h-3 w-full rounded-full bg-white/6" />
                    <div className="h-3 w-4/5 rounded-full bg-white/6" />
                    <div className="h-3 w-3/4 rounded-full bg-white/6" />
                  </div>
                  <div className="px-5 py-4 flex gap-2">
                    <div className="flex-1 h-10 rounded-xl bg-white/6" />
                    <div className="h-10 w-12 rounded-xl bg-white/6" />
                  </div>
                </div>
              </div>
            );

            const mobileCards = canonicalMobileOpportunities.slice(0, 8);
            const current = mobileCards[mobileCardIndex];
            if (!current) return (
              <div className="flex h-full items-center justify-center">
                <p className="text-zinc-500 font-bold">Scanning market...</p>
              </div>
            );
            return (
              <div
                className="h-full flex flex-col overflow-y-auto"
                onTouchStart={(e) => setMobileTouchStart(e.touches[0].clientX)}
                onTouchEnd={(e) => {
                  if (mobileTouchStart === null) return;
                  const diff = mobileTouchStart - e.changedTouches[0].clientX;
                  if (Math.abs(diff) > 50) {
                    if (diff > 0 && mobileCardIndex < mobileCards.length - 1) setMobileCardIndex(i => i + 1);
                    if (diff < 0 && mobileCardIndex > 0) setMobileCardIndex(i => i - 1);
                  }
                  setMobileTouchStart(null);
                }}
              >
                {apiOpportunitiesLoading && !apiMomentum ? (
                  <OpportunityStateCard loading compact />
                ) : apiMomentum ? (
                  <MobileSpotMomentumCard
                    opportunity={apiMomentum}
                    framework={smFramework}
                    trace={smTrace}
                    narrative={bullBearData?.ticker === apiMomentum.ticker ? bullBearData.htRead : null}
                    dualEngine={isDualEngineConfirmation}
                    watched={watchlist.includes(apiMomentum.ticker)}
                    onOpen={() => setSelectedStock(opportunityToStock(apiMomentum))}
                    onWatch={() => toggleWatchlist(apiMomentum.ticker)}
                    liveQuotes={liveQuotes}
                  />
                ) : (
                  <OpportunityStateCard loading={false} compact />
                )}

                <div className="mx-4 mb-3 flex-shrink-0 overflow-hidden rounded-2xl border border-violet-400/15 bg-black">
                  <MomentumContenders
                    candidates={momentumRunnersUp}
                    onSelect={(opportunity) =>
                      setSelectedStock(opportunityToStock(opportunity))
                    }
                    liveQuotes={liveQuotes}
                  />
                </div>

                {/* Mobile Before The Crowd reads the same canonical opportunity as desktop. */}
                {apiBeforeCrowdPick && (
                  <MobileBeforeCrowdCard
                    opportunity={apiBeforeCrowdPick}
                    framework={btcFramework}
                    trace={btcTrace}
                    dualEngine={isDualEngineConfirmation}
                    watched={watchlist.includes(apiBeforeCrowdPick.ticker)}
                    onOpen={() => setSelectedStock(opportunityToStock(apiBeforeCrowdPick))}
                    onWatch={() => toggleWatchlist(apiBeforeCrowdPick.ticker)}
                    liveQuotes={liveQuotes}
                  />
                )}

                <MobileCardDetail
                  opportunities={mobileCards}
                  currentIndex={mobileCardIndex}
                  watchlist={watchlist}
                  setCurrentIndex={setMobileCardIndex}
                  onOpen={(opportunity) => setSelectedStock(opportunityToStock(opportunity))}
                  onWatch={toggleWatchlist}
                  liveQuotes={liveQuotes}
                />
              </div>
            );
          })()}

          {/* CONVICTIONS TAB — canonical backend opportunities only */}
          {mobileTab === "convictions" && (
            <MobileConvictionsList
              opportunities={canonicalMobileOpportunities}
              liveQuotes={liveQuotes}
              onOpen={(opportunity) => {
                setSelectedStock(opportunityToStock(opportunity));
                setMobileTab("home");
              }}
            />
          )}

          {/* SCANNER TAB */}
          {mobileTab === "scanner" && (
            <div className="h-full overflow-y-auto px-4 pt-12 pb-24">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300 mb-2">Live Scanner</p>
              <p className="text-xs font-semibold text-zinc-500 mb-4">Every name HT is watching right now</p>
              <div className="mb-4">
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                  <span className="text-zinc-600">⌕</span>
                  <input
                    type="text"
                    placeholder="Search ticker..."
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter") handleTickerSearch(); }}
                    className="flex-1 bg-transparent text-sm font-black uppercase text-white outline-none placeholder:normal-case placeholder:text-zinc-600"
                  />
                </div>
              </div>
              {mobileScannerReads.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
                  <p className="text-sm font-semibold text-zinc-400">No qualifying reads right now.</p>
                  <p className="mt-1 text-[10px] font-semibold text-zinc-600">The market&apos;s quiet, or nothing clears the bar at the moment.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {mobileScannerReads.map((o) => {
                    const { label, tone } = getOtherReadState(o);
                    const displayQuote = resolveOpportunityDisplayQuote(
                      o,
                      liveQuotes,
                    );
                    const emoji =
                      (o.catalystScore ?? 0) >= 20 ? "⚡" :
                      o.isBeforeCrowd ? "👀" :
                      (o.relativeVolume ?? 0) >= 5 && o.change >= 5 ? "🔥" :
                      o.change >= 15 ? "🚀" :
                      o.opportunityScore >= 90 ? "🎯" :
                      "🔎";
                    return (
                      <button
                        key={o.ticker}
                        onClick={() => openReadTicker(o.ticker)}
                        className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{emoji}</span>
                          <div>
                            <p className="font-mono text-base font-black text-white">{o.ticker}</p>
                            <p className={`text-[10px] font-semibold ${tone}`}>{label}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-mono text-sm font-black ${displayQuote.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {displayQuote.change >= 0 ? "+" : ""}{displayQuote.change.toFixed(2)}%
                          </p>
                          <p className="text-[10px] font-black text-orange-300">{o.opportunityScore}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* WATCHLIST TAB — canonical score when evaluated, honest unranked state otherwise */}
          {mobileTab === "watchlist" && (
            <MobileWatchlist
              tickers={watchlist}
              stocks={watchlistStocks.filter((stock): stock is Stock => Boolean(stock))}
              opportunities={canonicalMobileOpportunities}
              onOpenStock={setSelectedStock}
              onOpenOpportunity={(opportunity) => setSelectedStock(opportunityToStock(opportunity))}
            />
          )}

          {/* PROFILE TAB */}
          {mobileTab === "profile" && (
            <div className="h-full overflow-y-auto px-4 pt-12 pb-24">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300 mb-4">Profile</p>
              {session ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-green-400/20 bg-green-500/[0.06] p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-400">Signed In</p>
                    <p className="mt-2 text-base font-black text-white">{session.user.email}</p>
                    <button
                      onClick={handleSignOut}
                      className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 text-sm font-black text-zinc-300"
                    >
                      Sign Out
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[["Watchlist", watchlist.length], ["Saved", savedSetups.length], ["Tracked", signalMemoryInsight?.tracked ?? 0]].map(([label, val]) => (
                      <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-center">
                        <p className="font-mono text-2xl font-black text-white">{val}</p>
                        <p className="mt-1 text-[9px] font-black uppercase text-zinc-500">{label}</p>
                      </div>
                    ))}
                  </div>
                  {signalMemoryInsight && signalMemoryInsight.tracked >= 5 && (
                    <div className="rounded-2xl border border-orange-400/20 bg-orange-500/[0.06] p-4">
                      <p className="text-[10px] font-black uppercase text-orange-300 mb-2">Signal Memory</p>
                      <p className="text-3xl font-black text-orange-300">{signalMemoryInsight.successRate ?? "--"}%</p>
                      <p className="text-xs font-semibold text-zinc-500">Win rate from {signalMemoryInsight.tracked} signals</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-zinc-400 mb-4">Sign in to save your watchlist and track your win rate.</p>
                  <input
                    type="email"
                    placeholder="Email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm outline-none placeholder:text-zinc-600 focus:border-orange-500"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAuth("signin"); }}
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm outline-none placeholder:text-zinc-600 focus:border-orange-500"
                  />
                  <button
                    onClick={() => handleAuth("signup")}
                    disabled={authLoading}
                    className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-black uppercase text-black disabled:opacity-50"
                  >
                    {authLoading ? "..." : "Create Account"}
                  </button>
                  <button
                    onClick={() => handleAuth("signin")}
                    disabled={authLoading}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-4 text-sm font-black uppercase text-zinc-300 disabled:opacity-50"
                  >
                    {authLoading ? "..." : "Sign In"}
                  </button>
                  {authMessage && <p className="text-xs font-semibold text-zinc-400 text-center">{authMessage}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Stock Detail Sheet — z-[300] sits above mobile overlay (z-200) */}
        {selectedStock && (
          <div
            className="fixed inset-0 z-[300] flex items-end justify-center bg-black/85 backdrop-blur-md"
            onClick={() => setSelectedStock(null)}
          >
            <div
              className="w-full max-h-[90vh] overflow-y-auto rounded-t-[1.5rem] border-t border-x border-violet-400/20 bg-zinc-950 pb-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="h-1 w-10 rounded-full bg-white/20" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3 border-b border-white/10">
                <div>
                  <p className="font-mono text-3xl font-black text-white">{selectedStock.symbol}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-base font-black text-white">${Number(liveQuotes[selectedStock.symbol]?.price ?? selectedOpportunity?.price ?? selectedStock.price).toFixed(2)}</span>
                    <span className={`font-mono text-sm font-black ${(liveQuotes[selectedStock.symbol]?.change ?? selectedOpportunity?.change ?? selectedStock.change) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {(liveQuotes[selectedStock.symbol]?.change ?? selectedOpportunity?.change ?? selectedStock.change) >= 0 ? "+" : ""}{Number(liveQuotes[selectedStock.symbol]?.change ?? selectedOpportunity?.change ?? selectedStock.change).toFixed(2)}%
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelectedStock(null)} className="text-zinc-500 text-2xl leading-none px-2">×</button>
              </div>

              {/* Canonical HT evaluation — identical data source as desktop */}
              <div className="px-5 py-4 border-b border-white/10">
                {selectedOpportunityLoading ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <p className="text-sm font-black text-zinc-300">Loading canonical HT evaluation…</p>
                  </div>
                ) : selectedOpportunity && selectedOpportunityPresentation ? (
                  <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between ${
                    selectedOpportunity.eligibility?.eligible
                      ? "border-green-400/25 bg-green-500/[0.06]"
                      : "border-yellow-400/20 bg-yellow-500/[0.05]"
                  }`}>
                    <p className={`font-mono text-[2.8rem] font-black leading-none ${
                      selectedOpportunity.eligibility?.eligible ? "text-green-400" : "text-yellow-400"
                    }`}>{selectedOpportunity.opportunityScore}</p>
                    <div className="text-right">
                      <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-500 mb-0.5">Opportunity Score</p>
                      <p className="text-sm font-black text-white">
                        {selectedOpportunity.eligibility?.eligible ? `${selectedOpportunity.tier ?? "watch"} opportunity` : "Monitoring only"}
                      </p>
                      <p className="text-[9px] font-black mt-0.5 text-violet-400">
                        {selectedOpportunityPresentation.crowdLabel} · {selectedOpportunityPresentation.riskLabel} risk
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.05] px-4 py-4">
                    <p className="text-sm font-black text-yellow-300">Not currently ranked</p>
                    <p className="mt-1 text-[10px] text-zinc-500">{selectedOpportunityError || "No canonical evaluation is available."}</p>
                  </div>
                )}
              </div>

              {selectedOpportunity && (
                <div className="px-5 py-4 border-b border-white/10">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-400 mb-2">Canonical Decision</p>
                  <p className="text-sm font-bold text-white leading-5">{selectedOpportunity.whyItMatters}</p>
                  <p className="mt-2 text-xs font-semibold text-zinc-500">{selectedOpportunity.riskNote}</p>
                  {!selectedOpportunity.eligibility?.eligible && selectedOpportunity.eligibility?.reasons?.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {selectedOpportunity.eligibility.reasons.map((reason) => (
                        <li key={reason} className="text-[11px] font-semibold text-yellow-300">• {reason}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}

              {selectedOpportunity?.proxIntelligence &&
                selectedOpportunity.proxIntelligence.status !== "unavailable" && (
                  <div className="px-5 py-4 border-b border-white/10">
                    <ProxPulse packet={selectedOpportunity.proxIntelligence} />
                  </div>
                )}

              {selectedOpportunityFramework && (
                <OpportunityWindow framework={selectedOpportunityFramework} compact />
              )}

              {/* Bull/Bear AI Read */}
              {bullBearLoading && bullBearTicker !== selectedStock.symbol ? (
                <div className="px-5 py-4 border-b border-white/10">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-400 mb-2">Supplemental Scenarios</p>
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-zinc-800 rounded w-full" />
                    <div className="h-3 bg-zinc-800 rounded w-4/5" />
                    <div className="h-3 bg-zinc-800 rounded w-3/5" />
                  </div>
                </div>
              ) : bullBearData?.ticker === selectedStock.symbol && (
                <div className="px-5 py-4 border-b border-white/10">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-400 mb-2">Supplemental Scenarios — not an eligibility verdict</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[8px] font-black uppercase text-green-400 mb-2">🐂 Bull Case</p>
                      <ul className="space-y-1.5">
                        {bullBearData.bullCase.slice(0, 3).map((pt: string, i: number) => (
                          <li key={i} className="flex gap-1.5 text-[11px] font-semibold text-zinc-300 leading-4">
                            <span className="text-green-500 shrink-0">+</span><span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[8px] font-black uppercase text-red-400 mb-2">🐻 Bear Case</p>
                      <ul className="space-y-1.5">
                        {bullBearData.bearCase.slice(0, 3).map((pt: string, i: number) => (
                          <li key={i} className="flex gap-1.5 text-[11px] font-semibold text-zinc-300 leading-4">
                            <span className="text-red-500 shrink-0">−</span><span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="px-5 py-4">
                <button
                  onClick={() => setSelectedStock(null)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3.5 text-sm font-black text-zinc-400"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Navigation */}
        <div className="flex-shrink-0 border-t border-white/10 bg-black/90 backdrop-blur-2xl pb-safe">
          <div className="grid grid-cols-5">
            {[
              { tab: "home" as const, icon: "🏠", label: "Home" },
              { tab: "convictions" as const, icon: "🔥", label: "Top" },
              { tab: "scanner" as const, icon: "⚡", label: "Scanner" },
              { tab: "watchlist" as const, icon: "⭐", label: "Watchlist" },
              { tab: "profile" as const, icon: "👤", label: "Profile" },
            ].map(({ tab, icon, label }) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                className={`flex flex-col items-center gap-1 py-3 transition ${mobileTab === tab ? "text-orange-400" : "text-zinc-600"}`}
              >
                <span className="text-xl">{icon}</span>
                <span className={`text-[9px] font-black uppercase tracking-[0.1em] ${mobileTab === tab ? "text-orange-400" : "text-zinc-600"}`}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
  );
}
