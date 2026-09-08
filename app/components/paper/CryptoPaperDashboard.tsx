"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatMarketPrice } from "@/lib/market-price-format";
import { suggestedCryptoPaperLimit } from "@/lib/crypto/paper-price-limit";
import type { CryptoPaperDashboard as Dashboard, CryptoPaperPreview, CryptoPaperSide } from "@/lib/crypto/paper-contracts";
import CoinApiResearchChart from "@/app/components/crypto/CoinApiResearchChart";

const usd = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US",{
  style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:Math.abs(value)>0 && Math.abs(value)<.01 ? 6 : 2,
}).format(value);
const price = (value: number | null | undefined) => value == null ? "—" : formatMarketPrice(value);
const when = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"}).format(new Date(value)) : "Unavailable";
const marketLabel = (id: string) => `${id.split("_")[2]}/USD · ${id.split("_")[0]}`;
const open = (status: string) => status === "open" || status === "partially_filled";
const inputClass = "mt-2 w-full min-w-0 rounded-xl border border-white/15 bg-[#101416] px-4 py-3 text-base text-white outline-none focus:border-orange-400";
type Pending = { clientId:string; previewCycleId:string; marketId:string; side:CryptoPaperSide; quantity:string; limitPrice:string };
type ApiReply = { ok:boolean; error?:string; dashboard?:Dashboard; preview?:CryptoPaperPreview; orderId?:string; status?:string };
class ApiError extends Error {
  constructor(message:string, readonly status:number) {super(message);}
}

/** Optional initial data is for isolated render tests. The live page never supplies a fixture. */
export default function CryptoPaperDashboard({ initialDashboard }: { initialDashboard?:Dashboard } = {}) {
  const [dashboard,setDashboard] = useState<Dashboard|null>(initialDashboard ?? null);
  const [authReady,setAuthReady] = useState(Boolean(initialDashboard));
  const [signedIn,setSignedIn] = useState(Boolean(initialDashboard));
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const [search,setSearch] = useState("");
  const [marketId,setMarketId] = useState("");
  const [side,setSide] = useState<CryptoPaperSide>("buy");
  const [quantity,setQuantity] = useState("");
  const [dollars,setDollars] = useState("100");
  const [sizeMode,setSizeMode] = useState<"dollars"|"units">("dollars");
  const [limit,setLimit] = useState("");
  const [review,setReview] = useState<CryptoPaperPreview|null>(null);
  const [pending,setPending] = useState<Pending|null>(null);
  const [clock,setClock] = useState(()=>Date.now());
  const [lastRead,setLastRead] = useState(()=>initialDashboard ? Date.now() : 0);
  const [readFailed,setReadFailed] = useState(false);
  const userId = useRef("");
  const mounted = useRef(true);
  const loading = useRef(false);

  const api = useCallback(async(body?:object):Promise<ApiReply> => {
    const {data} = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token || data.session?.user.id !== userId.current) throw new Error("Sign in to HT Labs to use paper trading.");
    const response = await fetch("/api/crypto/paper",{method:body?"POST":"GET",cache:"no-store",
      signal:AbortSignal.timeout(25_000),
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      ...(body?{body:JSON.stringify(body)}:{})});
    const result = await response.json() as ApiReply;
    if (!response.ok || !result.ok) throw new ApiError(result.error ?? "Crypto paper request could not be confirmed.",response.status);
    return result;
  },[]);

  const refresh = useCallback(async()=>{
    if (loading.current) return;
    const requestedUser = userId.current;
    loading.current = true;
    try {
      const result = await api();
      if (mounted.current && requestedUser === userId.current && result.dashboard) {
        setDashboard(result.dashboard);setLastRead(Date.now());setReadFailed(false);
      }
    } catch(cause) { if(mounted.current && requestedUser === userId.current) {
      setReadFailed(true);setError(cause instanceof Error?cause.message:"Could not read paper account.");
    } }
    finally { loading.current = false; }
  },[api]);

  useEffect(()=>{
    mounted.current = true;
    let cancelled = false;
    async function auth() {
      const {data} = await supabase.auth.getSession();
      if(cancelled) return;
      const nextUser = data.session?.user.id ?? "";
      if(userId.current !== nextUser) { setDashboard(null);setPending(null);setReview(null);setNotice("");setError("");setLastRead(0);setBusy(false); }
      userId.current = nextUser;
      setSignedIn(Boolean(nextUser));setAuthReady(true);
      if(nextUser) {
        try {
          const saved = sessionStorage.getItem(`ht-crypto-paper-pending:${nextUser}`);
          if(saved) setPending(JSON.parse(saved) as Pending);
        } catch { /* Storage is optional; server idempotency remains mandatory. */ }
        void refresh();
      }
    }
    void auth();
    const {data} = supabase.auth.onAuthStateChange(()=>{void auth();});
    const interval = setInterval(()=>{if(userId.current && document.visibilityState === "visible") void refresh();},5_000);
    const clockInterval = setInterval(()=>setClock(Date.now()),1_000);
    const visible = ()=>{if(userId.current && document.visibilityState === "visible") void refresh();};
    document.addEventListener("visibilitychange",visible);
    return ()=>{cancelled=true;mounted.current=false;data.subscription.unsubscribe();clearInterval(interval);clearInterval(clockInterval);document.removeEventListener("visibilitychange",visible);};
  },[refresh]);

  const markets = (dashboard?.feed.publication?.markets ?? []).filter(row=>row.coverage!=="asset_policy_excluded");
  // Once chosen, a missing market must never silently become another coin.
  const selected = marketId ? markets.find(row=>row.marketId === marketId) ?? null
    : markets.find(row=>row.marketId === dashboard?.positions[0]?.market_id)
      ?? markets.find(row=>row.marketId === "COINBASE_SPOT_BTC_USD") ?? markets[0] ?? null;
  const position = dashboard?.positions.find(row=>row.market_id === selected?.marketId);
  const activeOrders = dashboard?.orders.filter(order=>open(order.status)) ?? [];
  const matching = markets.filter(row=>`${row.base} ${row.exchange} ${row.marketId}`.toLowerCase().includes(search.toLowerCase())).slice(0,30);
  const readCurrent = !readFailed && clock-lastRead<=15_000;
  const feedReady = dashboard?.feed.status === "collecting" && readCurrent;
  const selectedCurrent = feedReady && selected?.priceStatus === "current" && Boolean(selected.priceAsOf)
    && clock-Date.parse(selected!.priceAsOf!)>=0 && clock-Date.parse(selected!.priceAsOf!)<=30_000;
  const marksCurrent = readCurrent && dashboard?.marksCurrent && dashboard.positions.every(p=>p.priceAsOf
    && clock-Date.parse(p.priceAsOf)>=0 && clock-Date.parse(p.priceAsOf)<=30_000);
  const markCurrent = (at:string|null) => feedReady && at!==null && clock-Date.parse(at)>=0 && clock-Date.parse(at)<=30_000;
  const selectedBook = selected?.book;
  const suggestedLimit = selectedBook ? suggestedCryptoPaperLimit(side === "buy" ? selectedBook.ask : selectedBook.bid,side) : "";
  const effectiveLimit = limit || suggestedLimit;

  function choose(id:string,nextSide:CryptoPaperSide = "buy",allQuantity?:string) {
    setMarketId(id);setSide(nextSide);setReview(null);setLimit("");setQuantity(allQuantity ?? "");
    setSizeMode(nextSide === "sell" ? "units" : "dollars");setNotice("");
  }
  async function perform(action:()=>Promise<void>) {
    if(busy) return;
    setBusy(true);setError("");
    const requestedUser=userId.current;
    try { await action(); } catch(cause) { if(requestedUser===userId.current) setError(cause instanceof Error?cause.message:"Request unavailable."); }
    finally { if(requestedUser===userId.current) setBusy(false); }
  }
  async function preview() {
    if(!selected) return;
    await perform(async()=>{
      const requestedUser=userId.current;
      const result = await api({action:"preview",marketId:selected.marketId,side,limitPrice:effectiveLimit,
        ...(side === "buy" && sizeMode === "dollars" ? {amountDollars:dollars} : {quantity})});
      if(requestedUser===userId.current) setReview(result.preview ?? null);
    });
  }
  async function submit(saved?:Pending) {
    if(!saved && !review) return;
    await perform(async()=>{
      const requestedUser=userId.current;
      const order = saved ?? {clientId:crypto.randomUUID(),previewCycleId:review!.cycleId,
        marketId:review!.marketId,side:review!.side,quantity:review!.quantity,limitPrice:review!.limitPrice};
      setPending(order);
      const storageKey=`ht-crypto-paper-pending:${requestedUser}`;
      try {sessionStorage.setItem(storageKey,JSON.stringify(order));} catch { /* Same in-memory key still survives a retry. */ }
      let result:ApiReply;
      try { result = await api({action:"submit",...order}); }
      catch(cause) {
        // A definite first-attempt rejection can return to editing. After a
        // transport failure keep the SAME key unless the ledger says absent.
        const definitelyRejected=cause instanceof ApiError && cause.status>=400 && cause.status<500
          && !cause.message.startsWith("Idempotency key reused") && (!saved || cause.status===409);
        if(definitelyRejected) {
          try {sessionStorage.removeItem(storageKey);} catch { /* No new order key is sent here. */ }
          if(requestedUser===userId.current) {setPending(null);setReview(null);}
        }
        throw cause;
      }
      try {sessionStorage.removeItem(storageKey);} catch { /* A repeated persisted key is idempotent. */ }
      if(requestedUser!==userId.current) return;
      setPending(null);setReview(null);
      setNotice(result.status === "filled" ? "Paper order filled. See your position below."
        : "Paper order submitted. It will fill only at your price limit or better, using a fresh CoinAPI quote. Track it below.");
      await refresh();
    });
  }

  return <main className="min-h-screen bg-[#050707] px-3 py-4 text-zinc-100 sm:px-6 sm:py-7">
    <div className="mx-auto max-w-[1500px] overflow-hidden rounded-3xl border border-white/10 bg-[#090d0e]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
        <Link href="/" aria-label="HT Labs home"><Image src="/logo.png" alt="HT Labs" width={98} height={66} className="h-10 w-auto" priority /></Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm sm:gap-6"><Link href="/paper" className="text-zinc-400 hover:text-white">Stocks</Link><span className="font-semibold text-orange-300">Crypto paper</span><Link href="/crypto/research" className="text-zinc-400 hover:text-white">Research</Link>{dashboard?.account && <a href="#crypto-paper-ticket" className="text-cyan-200">Trade ↓</a>}</nav>
        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1 text-xs text-cyan-200">Virtual money only</span>
      </header>
      <div className="px-5 pt-4 sm:px-7">
        {error && <p role="alert" className="mb-4 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-sm text-cyan-100">{notice}</p>}
      </div>
      {!authReady ? <p className="p-8 text-zinc-400">Loading your paper workspace…</p>
        : !signedIn ? <section className="px-6 py-12 sm:px-10"><h1 className="text-3xl font-semibold">Your crypto practice account.</h1><p className="mt-3 max-w-xl text-zinc-400">Buy and sell spot crypto with virtual dollars and shared CoinAPI prices. Your stock paper account stays separate.</p><Link href="/?tab=profile" className="mt-6 inline-block rounded-xl bg-orange-500 px-6 py-3 font-semibold text-black">Sign in to start</Link></section>
        : !dashboard ? <section className="p-8"><h1 className="text-2xl font-semibold">Crypto paper trading</h1><p className="mt-3 text-sm text-zinc-400">Waiting for the account and shared market data.</p><button type="button" onClick={()=>void refresh()} className="mt-5 rounded-xl border border-white/20 px-5 py-3">Check connection</button></section>
        : <>
          <section className="grid gap-5 border-b border-white/10 px-5 py-5 sm:grid-cols-2 sm:px-7 lg:grid-cols-4">
            <Metric title="Crypto paper portfolio" value={usd(dashboard.equity)} detail={marksCurrent ? "Separate from stock paper funds" : "Based on last available prices"} large />
            <Metric title="Available to trade" value={usd(dashboard.buyingPower)} detail={`${usd(dashboard.reservedCash)} reserved for open buys`} />
            <Metric title="Cash" value={usd(dashboard.account?.cash)} detail="USD · virtual balance" />
            <Metric title="Realized P&L" value={usd(dashboard.account?.realized_pnl)} detail="Closed trades · after simulated fees" positive={(dashboard.account?.realized_pnl ?? 0)>=0} />
          </section>
          {!dashboard.account && <section className="flex flex-wrap items-center justify-between gap-5 border-b border-white/10 bg-cyan-300/[.03] px-5 py-6 sm:px-7"><div><h1 className="text-2xl font-semibold">Start with $100,000 in virtual crypto cash.</h1><p className="mt-2 text-sm text-zinc-400">A separate practice balance. No deposit, live broker or automatic Agent trades.</p></div><button type="button" disabled={busy} onClick={()=>void perform(async()=>{await api({action:"open_account"});await refresh();})} className="rounded-xl bg-orange-500 px-5 py-3 font-semibold text-black disabled:opacity-50">Open crypto paper account</button></section>}
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 border-b border-white/10 p-5 sm:p-7 lg:border-b-0 lg:border-r">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-xs uppercase tracking-widest text-zinc-500">{selected?.exchange ?? "CoinAPI"} · spot market</p><h1 className="mt-2 text-3xl font-semibold">{selected ? `${selected.base}/USD` : "Find a crypto"}</h1><p className="mt-2 font-mono text-2xl">{price(selected?.price)}</p></div>
                <div className="text-xs text-zinc-400"><p className={selectedCurrent ? "text-cyan-300" : "text-amber-200"}>{selectedCurrent ? "Current provider price" : "Last available price"}</p><p className="mt-2">{when(selected?.priceAsOf)}</p><p className="mt-2">Shared feed · every 60 seconds</p></div>
              </div>
              {!feedReady && <p className="mb-5 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">{!readCurrent ? "Connection needs refreshing." : dashboard.feed.reason === "unknown_provider_cost" ? "CoinAPI collection is paused while a request’s usage is reconciled." : `Shared feed: ${dashboard.feed.status.replaceAll("_"," ")}.`} Prices remain timestamped. New orders need a current collection; stale prices cannot fill orders.</p>}
              {marketId && !selected && <p role="status" className="mb-5 text-sm text-amber-100">{marketLabel(marketId)} is unavailable in this collection. Your position is preserved; another coin will not be substituted.</p>}
              {selected?.chart ? <CoinApiResearchChart marketId={selected.marketId} bars={selected.chart.bars} />
                : <div className="rounded-2xl border border-white/10 bg-white/[.015] p-6"><h2 className="font-medium">Quote-only coverage</h2><p className="mt-2 text-sm text-zinc-400">This market has no candle history in the latest shared collection. Buying and selling uses verified bid/ask quotes; opening a chart does not generate extra CoinAPI charges.</p></div>}
              <div className="mt-5 grid grid-cols-2 gap-3"><Metric title="Bid · selling reference" value={price(selectedBook?.bid)} detail={`Book time ${when(selectedBook?.asOf)}`} /><Metric title="Ask · buying reference" value={price(selectedBook?.ask)} detail="Bid/ask can differ from the last trade" /></div>
              <section className="mt-7"><label htmlFor="crypto-market-search" className="text-sm font-semibold">Find a coin or exchange</label><input id="crypto-market-search" className={inputClass} placeholder="BTC, DOGE, PEPE, Coinbase…" value={search} onChange={event=>setSearch(event.target.value)} />
                <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">{matching.map(row=><button type="button" key={row.marketId} disabled={Boolean(pending)} onClick={()=>choose(row.marketId)} className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left ${selected?.marketId===row.marketId?"border-cyan-300/40 bg-cyan-300/5":"border-white/10 hover:bg-white/5"}`}><span><span className="block text-sm font-semibold">{row.base}/USD</span><span className="text-xs text-zinc-500">{row.exchange}</span></span><span className="font-mono text-sm">{price(row.price)}</span></button>)}</div>
                <p className="mt-2 text-xs text-zinc-500">Exact exchange pairs from CoinAPI. Not a recommendation ranking.</p>
              </section>
            </section>
            <aside id="crypto-paper-ticket" className="min-w-0 p-5 sm:p-7">
              <h2 className="text-xl font-semibold">{selected ? `Trade ${selected.base}` : "Your paper order"}</h2>
              <p className="mt-1 text-xs text-zinc-500">Manual spot trading · buy and sell only</p>
              {pending ? <section className="mt-6 rounded-2xl border border-amber-300/25 p-4"><h3 className="font-semibold">Confirming your request</h3><p className="mt-3 text-sm text-zinc-400">{marketLabel(pending.marketId)} · {pending.side} {pending.quantity}. Retrying uses the same order ID and cannot submit it twice.</p><button type="button" disabled={busy} onClick={()=>void submit(pending)} className="mt-5 w-full rounded-xl bg-orange-500 px-4 py-3 font-semibold text-black disabled:opacity-50">{busy?"Checking…":"Retry same request"}</button></section>
                : review ? <section className="mt-6"><p className="mb-4 text-xs uppercase tracking-widest text-orange-300">Review your paper {review.side}</p><dl className="space-y-4 text-sm"><Line label="Market" value={marketLabel(review.marketId)} /><Line label="Units" value={review.quantity} /><Line label={review.side==="buy"?"Maximum unit price":"Minimum unit price"} value={price(Number(review.limitPrice))} /><Line label="Order value at limit" value={usd(review.notional)} /><Line label="Estimated fee · 0.60%" value={usd(review.estimatedFee)} /><Line label={review.side==="buy"?"Maximum total cost":"Minimum net proceeds"} value={usd(review.total)} strong /><Line label="Available buying power" value={usd(review.buyingPowerBefore)} /><Line label="Buying power after full fill" value={usd(review.buyingPowerAfter)} /></dl><p className="mt-5 text-xs leading-5 text-zinc-400">A limit order, valid for 10 minutes. It waits for fresh quotes after you submit. Partial fills are possible; fees apply only to filled units. The fee and 0.10% adverse slippage are simulation assumptions, not your exchange’s quoted fees.</p><button type="button" disabled={busy || !feedReady || !dashboard.enabled} onClick={()=>void submit()} className="mt-5 w-full rounded-xl bg-orange-500 px-5 py-4 font-semibold text-black disabled:opacity-40">Confirm paper {review.side}</button><button type="button" disabled={busy} onClick={()=>setReview(null)} className="mt-3 w-full py-2 text-sm text-zinc-400">Edit order</button></section>
                  : <form className="mt-6" onSubmit={event=>{event.preventDefault();void preview();}}>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">{(["buy","sell"] as const).map(value=><button type="button" key={value} onClick={()=>{setSide(value);setLimit("");setSizeMode(value==="sell"?"units":"dollars");}} className={`rounded-lg py-3 text-sm font-semibold capitalize ${side===value?(value==="buy"?"bg-emerald-400/10 text-emerald-300":"bg-orange-400/10 text-orange-300"):"text-zinc-400"}`}>{value}</button>)}</div>
                    {position && <div className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-300/[.03] p-4"><p className="text-xs text-cyan-300">Your position</p><p className="mt-2 font-mono text-sm">{position.quantity} {selected?.base}</p><p className="mt-1 text-xs text-zinc-400">P&L {usd(position.unrealizedPnl)} at shown price</p><button type="button" onClick={()=>choose(position.market_id,"sell",position.available_quantity)} className="mt-3 text-sm font-semibold text-orange-300">Sell all available →</button></div>}
                    {side==="buy" && <div className="mt-5 flex gap-4 text-sm"><button type="button" className={sizeMode==="dollars"?"text-orange-300":"text-zinc-500"} onClick={()=>setSizeMode("dollars")}>Dollars</button><button type="button" className={sizeMode==="units"?"text-orange-300":"text-zinc-500"} onClick={()=>setSizeMode("units")}>Units</button></div>}
                    <label className="mt-5 block text-sm text-zinc-400" htmlFor="crypto-quantity">{side==="buy" && sizeMode==="dollars"?"Spend up to (including fees)":"Units to sell or buy"}</label><input id="crypto-quantity" className={inputClass} inputMode="decimal" autoComplete="off" required value={side==="buy" && sizeMode==="dollars"?dollars:quantity} onChange={event=>side==="buy" && sizeMode==="dollars"?setDollars(event.target.value):setQuantity(event.target.value)} placeholder={side==="buy" && sizeMode==="dollars"?"USD amount":"0.00"} />
                    <label className="mt-5 block text-sm text-zinc-400" htmlFor="crypto-price-limit">{side==="buy"?"Maximum price per coin":"Minimum price per coin"}</label><input id="crypto-price-limit" className={inputClass} inputMode="decimal" autoComplete="off" required value={effectiveLimit} onChange={event=>setLimit(event.target.value)} /><p className="mt-2 text-xs leading-5 text-zinc-500">Editable price protection. Default gives the shown bid/ask 0.5% room. Your limit is fixed when you review.</p>
                    <div className="mt-6 border-t border-white/10 pt-4 text-sm"><dl><Line label="Available buying power" value={usd(dashboard.buyingPower)} /></dl><p className="mt-3 text-xs leading-5 text-zinc-500">Review shows the total, fees and remaining balance before you confirm. No real money moves.</p></div>
                    <button type="submit" disabled={busy || !selected || !dashboard.account || !feedReady || !dashboard.enabled} className="mt-5 w-full rounded-xl bg-orange-500 px-5 py-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">{busy?"Calculating…":"Review paper order"}</button>
                  </form>}
              {!dashboard.enabled && <p className="mt-4 text-sm text-amber-200">Manual crypto paper trading is paused. Existing orders can still be cancelled.</p>}
            </aside>
          </div>
          <section className="border-t border-white/10 px-5 py-6 sm:px-7"><h2 className="text-lg font-semibold">Your positions</h2>
            {!dashboard.positions.length ? <p className="mt-3 text-sm text-zinc-500">Your first filled paper buy will appear here, with a clear Sell button.</p>
              : <div className="mt-4 grid gap-3 md:grid-cols-2">{dashboard.positions.map(row=><div key={row.market_id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 p-4"><div><p className="font-semibold">{marketLabel(row.market_id)}</p><p className="mt-1 text-sm text-zinc-400">{row.quantity} units · value {usd(row.marketValue)}</p><p className="mt-1 text-xs text-zinc-500">{row.current && markCurrent(row.priceAsOf)?"Current":"Last available"} mark {when(row.priceAsOf)} · excludes exit fees</p></div><div className="text-right"><p className={(row.unrealizedPnl??0)>=0?"text-emerald-300":"text-rose-300"}>{usd(row.unrealizedPnl)}</p><button type="button" disabled={Boolean(pending)||Number(row.available_quantity)<=0} onClick={()=>{choose(row.market_id,"sell",row.available_quantity);document.getElementById("crypto-quantity")?.scrollIntoView({behavior:"smooth",block:"center"});}} className="mt-2 rounded-lg border border-orange-300/25 px-4 py-2 text-sm font-semibold text-orange-300 disabled:opacity-40">Sell / close</button></div></div>)}</div>}
          </section>
          <section className="border-t border-white/10 px-5 py-6 sm:px-7"><h2 className="text-lg font-semibold">Open orders <span className="ml-2 text-sm text-zinc-500">{activeOrders.length}</span></h2><p className="mt-2 text-xs text-zinc-500">Matching checks the shared feed each minute. Stale quotes, insufficient displayed liquidity, or an unmet limit leave an order waiting. Unfilled quantities expire after 10 minutes.</p><div className="mt-4 space-y-3">{activeOrders.map(order=><div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><div><p className="text-sm font-semibold capitalize">{order.side} · {marketLabel(order.market_id)}</p><p className="mt-2 text-sm text-zinc-400">{order.filled_quantity} / {order.quantity} filled · limit {price(Number(order.limit_price))}</p><p className="mt-1 text-xs text-zinc-500">{order.status.replaceAll("_"," ")} · expires {when(order.expires_at)}</p></div><button type="button" disabled={busy} onClick={()=>void perform(async()=>{await api({action:"cancel",orderId:order.id});await refresh();setNotice("Unfilled quantity cancelled. Any completed fills remain in your account.");})} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel remainder</button></div>)}</div></section>
          <details className="border-t border-white/10 px-5 py-5 sm:px-7"><summary className="cursor-pointer text-sm font-semibold">Fills and order history</summary><div className="mt-4 space-y-3">{dashboard.fills.map(fill=><div key={fill.id} className="rounded-xl bg-white/[.025] p-4 text-sm"><p className="font-semibold capitalize">{fill.side} {fill.quantity} · {marketLabel(fill.market_id)}</p><p className="mt-2 text-zinc-400">Filled at {price(fill.price)} · fee {usd(fill.fee)} · {when(fill.provider_at)}</p>{fill.side==="sell"&&<p className="mt-1 text-zinc-300">Realized P&L {usd(fill.realized_pnl)} after entry and exit fees</p>}</div>)}{dashboard.orders.filter(order=>!open(order.status)).map(order=><p key={order.id} className="text-xs text-zinc-500">{marketLabel(order.market_id)} · {order.side} · {order.status} · {order.filled_quantity}/{order.quantity} filled</p>)}</div></details>
        </>}
      <footer className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-zinc-500 sm:px-7">HT Labs paper simulation. Uses observed CoinAPI spot bid/ask, displayed liquidity and provider timestamps. Estimated fees and slippage are not exchange-specific promises. No brokerage connection, leverage, crypto shorts or Agent autopilot.</footer>
    </div>
  </main>;
}

function Metric({title,value,detail,large,positive}:{title:string;value:string;detail:string;large?:boolean;positive?:boolean}) {
  return <div className="min-w-0"><p className="text-xs text-zinc-500">{title}</p><p className={`mt-2 break-words font-mono font-semibold ${large?"text-3xl":"text-xl"} ${positive===undefined?"":positive?"text-emerald-300":"text-rose-300"}`}>{value}</p><p className="mt-2 text-[11px] text-zinc-500">{detail}</p></div>;
}
function Line({label,value,strong}:{label:string;value:string;strong?:boolean}) {
  return <div className={`flex items-start justify-between gap-3 ${strong?"border-t border-white/10 pt-4 font-semibold":""}`}><dt className="text-zinc-400">{label}</dt><dd className="break-words text-right">{value}</dd></div>;
}
