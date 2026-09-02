"use client";

import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import HeroPriceChart from "@/app/components/market/HeroPriceChart";
import type {
  PaperApiResponse,
  PaperDashboard,
  PaperInstrumentView,
  PaperPositionView,
} from "@/lib/paper-trading/contracts";
import {
  calculatePaperCloseQuantity,
  calculatePaperOrderImpact,
  type PaperOrderImpact,
  type PaperOrderSide,
  type PaperOrderType,
  type PaperTimeInForce,
} from "@/lib/paper-trading/engine";
import { supabase } from "@/lib/supabaseClient";
import { HT_REFRESH_RATES_MS } from "@/lib/runtime-capabilities";

const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
}).format(value);
const amount = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
const compactNumber = (value: number) => new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
}).format(value);

const sideLabels: Record<PaperOrderSide, string> = {
  buy: "Buy",
  sell: "Sell",
  sell_short: "Short",
  buy_to_cover: "Cover",
};
const sourceValues = new Set(["manual", "spot_momentum", "before_crowd", "scanner", "ticker_detail"]);

type Ticket = {
  symbol: string;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  timeInForce: PaperTimeInForce;
  quantity: string;
  limitPrice: string;
  stopPrice: string;
  allowExtendedHours: boolean;
  bracket: boolean;
  takeProfitPrice: string;
  stopLossPrice: string;
  closePosition: boolean;
};

type ActivityTab = "positions" | "orders" | "fills" | "history";
type SizingMode = "dollars" | "shares";

const paperSidesForPosition = (side?: "long" | "short"): PaperOrderSide[] => {
  if (side === "long") return ["buy", "sell"];
  if (side === "short") return ["sell_short", "buy_to_cover"];
  return ["buy", "sell_short"];
};

const emptyTicket = (symbol = ""): Ticket => ({
  symbol,
  side: "buy",
  orderType: "market",
  timeInForce: "day",
  quantity: "",
  limitPrice: "",
  stopPrice: "",
  allowExtendedHours: false,
  bracket: false,
  takeProfitPrice: "",
  stopLossPrice: "",
  closePosition: false,
});

function AccountMetric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 border-white/8 lg:border-l lg:pl-6">
      <p className="text-[10px] font-semibold text-zinc-600">{label}</p>
      <p className={`mt-1 truncate font-mono text-sm font-black ${tone}`}>{value}</p>
    </div>
  );
}

function Field({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-zinc-500">
        <span>{label}</span>{detail && <span className="truncate text-zinc-700">{detail}</span>}
      </span>
      {children}
    </label>
  );
}

function orderTone(status: string) {
  if (status === "filled") return "border-green-400/20 bg-green-500/10 text-green-300";
  if (status === "open" || status === "accepted" || status === "partially_filled") return "border-orange-400/20 bg-orange-500/10 text-orange-300";
  if (status === "rejected") return "border-red-400/20 bg-red-500/10 text-red-300";
  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function OrderEstimate({
  impact,
  side,
  dataMode,
}: {
  impact: PaperOrderImpact;
  side: PaperOrderSide;
  dataMode: "delayed" | "real_time";
}) {
  const capitalLabel = side === "sell_short"
    ? "Margin required"
    : side === "sell"
      ? "Estimated proceeds"
      : side === "buy_to_cover"
        ? "Buying power change"
        : "Buying power used";
  const capitalValue = side === "sell_short"
    ? impact.estimatedMarginRequired
    : side === "sell"
      ? impact.estimatedNotional
      : side === "buy_to_cover"
        ? impact.buyingPowerChange
        : impact.estimatedNotional;
  const capitalRequired = side === "sell_short"
    ? impact.estimatedMarginRequired
    : side === "buy"
      ? impact.estimatedNotional
      : 0;
  const usagePercent = impact.buyingPowerBefore > 0
    ? Math.min(100, Math.max(0, capitalRequired / impact.buyingPowerBefore * 100))
    : 0;
  const afterTone = impact.buyingPowerAfter < 0
    ? "text-red-300"
    : "text-green-300";

  return (
    <div className="overflow-hidden rounded-xl border border-orange-400/15 bg-orange-500/[0.035]">
      <div className="flex items-end justify-between gap-4 border-b border-white/[0.06] px-4 py-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-orange-300">
            Order estimate
          </p>
          <p className="mt-1 text-[9px] font-semibold text-zinc-600">
            {amount(impact.quantity)} shares × {money(impact.referencePrice)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            Total value
          </p>
          <p className="mt-1 font-mono text-lg font-black text-white">
            {money(impact.estimatedNotional)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-white/[0.06] border-b border-white/[0.06]">
        <div className="px-4 py-3">
          <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            Buying power now
          </p>
          <p className="mt-1 font-mono text-xs font-black text-zinc-300">
            {money(impact.buyingPowerBefore)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
            After fill
          </p>
          <p className={`mt-1 font-mono text-xs font-black ${afterTone}`}>
            {money(impact.buyingPowerAfter)}
          </p>
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3 text-[9px] font-semibold">
          <span className="text-zinc-600">{capitalLabel}</span>
          <strong className="font-mono text-zinc-300">{money(capitalValue)}</strong>
        </div>
        {capitalRequired > 0 && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-orange-400"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        )}
        <p className="mt-2 text-[8px] font-semibold leading-4 text-zinc-700">
          Based on the current {dataMode.replace("_", " ")} verified quote. Final simulated fill and buying power are rechecked by the server.
        </p>
      </div>
    </div>
  );
}

export default function PaperTradingDashboard() {
  const searchParams = useSearchParams();
  const initialSymbol = (searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10);
  const requestedSource = searchParams.get("source") ?? "manual";
  const strategySource = sourceValues.has(requestedSource) ? requestedSource : "manual";
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<PaperDashboard | null>(null);
  const [instrument, setInstrument] = useState<PaperInstrumentView | null>(null);
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  const [instrumentError, setInstrumentError] = useState("");
  const [ticket, setTicket] = useState<Ticket>(() => emptyTicket(initialSymbol));
  const [sizingMode, setSizingMode] = useState<SizingMode>("dollars");
  const [dollarAmount, setDollarAmount] = useState("");
  const [activityTab, setActivityTab] = useState<ActivityTab>("positions");
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const initialInstrumentRequested = useRef(false);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const auth = await supabase.auth.getSession();
    const token = auth.data.session?.access_token;
    if (!token) throw new Error("Sign in to use paper trading.");
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json()) as PaperApiResponse;
    if (!response.ok || !body.ok) throw new Error(body.error ?? "Paper trading request failed.");
    return body;
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!session) return;
    if (!quiet) setLoading(true);
    try {
      const body = await api("/api/paper-trading/account");
      setDashboard(body.dashboard ?? null);
      if (!quiet) setMessage("");
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "Paper account unavailable.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
      if (!data.session) setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      setAuthReady(true);
      if (!next) {
        setDashboard(null);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 20_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh, session]);

  const lookupInstrument = useCallback(async (symbol: string, quiet = false) => {
    const clean = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10);
    if (!clean) {
      if (!quiet) setInstrumentError("Enter a ticker first.");
      return;
    }
    if (!quiet) {
      const symbolChanged = instrument?.symbol !== clean;
      setTicket((current) => ({
        ...(symbolChanged ? emptyTicket(clean) : current),
        symbol: clean,
      }));
      if (symbolChanged) {
        setSizingMode("dollars");
        setDollarAmount("");
      }
      setInstrumentLoading(true);
      setInstrumentError("");
      setReviewing(false);
    }
    try {
      const body = await api(`/api/paper-trading/instrument?symbol=${encodeURIComponent(clean)}`);
      if (body.instrument) {
        setInstrument(body.instrument);
        if (!quiet) {
          const validSides = paperSidesForPosition(body.instrument.position?.side);
          setTicket((current) => validSides.includes(current.side)
            ? current
            : {
                ...current,
                side: validSides[0],
                quantity: "",
                closePosition: false,
                bracket: false,
              });
        }
      } else if (!quiet) {
        setInstrument(null);
        setInstrumentError("No verified instrument data was returned.");
      }
    } catch (error) {
      if (!quiet) {
        setInstrument(null);
        setInstrumentError(error instanceof Error ? error.message : "Instrument lookup failed.");
      }
    } finally {
      if (!quiet) setInstrumentLoading(false);
    }
  }, [api, instrument?.symbol]);

  useEffect(() => {
    if (!session || !instrument?.symbol) return;
    const symbol = instrument.symbol;
    const timer = window.setInterval(
      () => void lookupInstrument(symbol, true),
      HT_REFRESH_RATES_MS.selectedQuotes,
    );
    return () => window.clearInterval(timer);
  }, [instrument?.symbol, lookupInstrument, session]);

  useEffect(() => {
    if (!session || !dashboard || initialInstrumentRequested.current) return;
    initialInstrumentRequested.current = true;
    const landingSymbol = initialSymbol
      || dashboard.positions[0]?.symbol
      || dashboard.orders[0]?.symbol
      || "SPY";
    const timer = window.setTimeout(() => void lookupInstrument(landingSymbol), 0);
    return () => window.clearTimeout(timer);
  }, [dashboard, initialSymbol, lookupInstrument, session]);

  const ticketReady = instrument?.symbol === ticket.symbol && Number(ticket.quantity) > 0
    && (!(ticket.orderType === "limit" || ticket.orderType === "stop_limit") || Number(ticket.limitPrice) > 0)
    && (!(ticket.orderType === "stop" || ticket.orderType === "stop_limit") || Number(ticket.stopPrice) > 0)
    && (!ticket.bracket || (Number(ticket.takeProfitPrice) > 0 && Number(ticket.stopLossPrice) > 0));

  const orderImpact = useMemo(() => {
    const quantity = Number(ticket.quantity);
    if (
      !dashboard ||
      instrument?.symbol !== ticket.symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return null;
    }
    const position = instrument.position
      ? {
          quantity: instrument.position.side === "short"
            ? -instrument.position.quantity
            : instrument.position.quantity,
          averageEntryPrice: instrument.position.averageEntryPrice,
          shortMarginHeld: instrument.position.shortMarginHeld,
        }
      : null;
    return calculatePaperOrderImpact({
      side: ticket.side,
      quantity,
      quotePrice: instrument.price,
      account: {
        cashBalance: dashboard.account.cashBalance,
        shortMarginHeld: dashboard.account.shortMarginHeld,
      },
      position,
    });
  }, [dashboard, instrument, ticket.quantity, ticket.side, ticket.symbol]);

  const payload = useMemo(() => ({
    symbol: ticket.symbol,
    side: ticket.side,
    orderType: ticket.orderType,
    timeInForce: ticket.timeInForce,
    quantity: Number(ticket.quantity),
    limitPrice: ticket.limitPrice || null,
    stopPrice: ticket.stopPrice || null,
    allowExtendedHours: ticket.allowExtendedHours,
    takeProfitPrice: ticket.bracket ? ticket.takeProfitPrice || null : null,
    stopLossPrice: ticket.bracket ? ticket.stopLossPrice || null : null,
    closePosition: ticket.closePosition,
    strategySource,
  }), [strategySource, ticket]);

  const submit = async () => {
    setSubmitting(true);
    setMessage("Submitting manual simulation order...");
    try {
      const body = await api("/api/paper-trading/orders", { method: "POST", body: JSON.stringify(payload) });
      setDashboard(body.dashboard ?? null);
      setMessage(body.message ?? "Paper order submitted.");
      setReviewing(false);
      void lookupInstrument(ticket.symbol);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Paper order failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (orderId: string) => {
    setMessage("Cancelling paper order...");
    try {
      const body = await api(`/api/paper-trading/orders?orderId=${encodeURIComponent(orderId)}`, { method: "DELETE" });
      setDashboard(body.dashboard ?? null);
      setMessage("Paper order cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    }
  };

  const closePosition = (position: PaperPositionView) => {
    setSizingMode("shares");
    setDollarAmount("");
    setTicket({
      ...emptyTicket(position.symbol),
      side: position.side === "long" ? "sell" : "buy_to_cover",
      quantity: String(position.quantity),
      closePosition: true,
    });
    void lookupInstrument(position.symbol);
    setReviewing(true);
    setMessage(`Reviewing a full ${position.side} close for ${position.symbol}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const preparePositionClose = (
    position: PaperPositionView,
    fraction = 1,
    review = false,
  ) => {
    const quantity = calculatePaperCloseQuantity(position.quantity, fraction);
    setSizingMode("shares");
    setDollarAmount("");
    setTicket({
      ...emptyTicket(position.symbol),
      side: position.side === "long" ? "sell" : "buy_to_cover",
      quantity: String(quantity),
      closePosition: fraction >= 1,
    });
    setReviewing(review);
    setMessage(
      `${review ? "Reviewing" : "Prepared"} a ${Math.round(fraction * 100)}% ${position.side === "long" ? "sale" : "cover"} for ${position.symbol}.`,
    );
  };

  const selectOrderSide = (side: PaperOrderSide) => {
    const position = instrument?.position ?? null;
    const closesLoadedPosition =
      (side === "sell" && position?.side === "long") ||
      (side === "buy_to_cover" && position?.side === "short");
    setTicket({
      ...ticket,
      side,
      bracket: false,
      quantity: closesLoadedPosition ? String(position.quantity) : ticket.quantity,
      closePosition: closesLoadedPosition,
    });
    setReviewing(false);
  };

  const setShares = (value: string) => {
    setSizingMode("shares");
    setDollarAmount("");
    setTicket({ ...ticket, quantity: value, closePosition: false });
    setReviewing(false);
  };

  const setDollars = (value: string) => {
    setSizingMode("dollars");
    setDollarAmount(value);
    const dollars = Number(value);
    const price = instrument?.price ?? 0;
    const quantity = Number.isFinite(dollars) && dollars > 0 && price > 0
      ? String(Number((dollars / price).toFixed(8)))
      : "";
    setTicket({ ...ticket, quantity, closePosition: false });
    setReviewing(false);
  };

  const selectSizingMode = (mode: SizingMode) => {
    if (mode === "dollars" && !dollarAmount) {
      const quantity = Number(ticket.quantity);
      const price = instrument?.price ?? 0;
      if (Number.isFinite(quantity) && quantity > 0 && price > 0) {
        setDollarAmount(String(Number((quantity * price).toFixed(2))));
      }
    }
    setSizingMode(mode);
    setReviewing(false);
  };

  const applyBuyingPowerPercent = (fraction: number) => {
    if (!dashboard) return;
    const dollars = Math.floor(dashboard.account.buyingPower * fraction * 100) / 100;
    setDollars(String(dollars));
  };

  const openOrders = dashboard?.orders.filter((order) => ["accepted", "open", "partially_filled"].includes(order.status)) ?? [];
  const availableSides = useMemo<PaperOrderSide[]>(() => {
    return paperSidesForPosition(instrument?.position?.side);
  }, [instrument?.position?.side]);
  const recentSymbols = useMemo(() => {
    if (!dashboard) return [];
    return Array.from(new Set([
      ...dashboard.positions.map((position) => position.symbol),
      ...dashboard.orders.map((order) => order.symbol),
      ...dashboard.fills.map((fill) => fill.symbol),
    ])).slice(0, 6);
  }, [dashboard]);

  return (
    <main className="min-h-screen bg-[#050707] px-3 pb-28 pt-4 text-white sm:px-6 sm:py-7">
      <div className="mx-auto max-w-[1500px] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#080a0b] shadow-[0_28px_100px_rgba(0,0,0,0.5)]">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-white/8 px-5 py-4 sm:px-7">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="HT Labs home"><Image src="/logo.png" alt="HT Labs" width={2909} height={1959} className="h-9 w-auto" priority /></Link>
            <nav className="hidden items-center gap-6 text-xs font-bold text-zinc-600 md:flex">
              <Link href="/" className="transition hover:text-white">Top Convictions</Link>
              <Link href="/scanner" className="transition hover:text-white">Scanner</Link>
              <Link href="/crypto" className="transition hover:text-white">Crypto</Link>
              <span className="text-orange-300">Paper</span>
              <Link href="/agent" className="transition hover:text-white">HT Agent</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-semibold text-zinc-500"><span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_14px_rgba(74,222,128,0.55)]" />Paper account active</div>
        </header>

        {!authReady || loading ? (
          <div className="min-h-[650px] animate-pulse bg-white/[0.015]" />
        ) : !session ? (
          <section className="p-10 text-center sm:p-16">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">HT Paper</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight">Practice without risking real money</h1>
            <p className="mx-auto mt-4 max-w-xl text-sm font-semibold leading-6 text-zinc-500">Sign in to open your private $100,000 simulation account. No live brokerage connection is used.</p>
            <Link href="/?tab=profile" className="mt-7 inline-flex rounded-xl bg-orange-500 px-6 py-3 text-sm font-black text-black">Open Profile</Link>
          </section>
        ) : !dashboard ? (
          <section className="p-8 sm:p-12">
            <h1 className="text-2xl font-black">Paper account unavailable</h1>
            <p className="mt-3 text-sm font-semibold text-zinc-500">{message || "Apply migration 0024, then refresh."}</p>
            <button onClick={() => void refresh()} className="mt-5 rounded-xl border border-white/10 px-5 py-3 text-sm font-black">Try again</button>
          </section>
        ) : (
          <>
            <section className="grid gap-5 border-b border-white/8 px-5 py-5 sm:grid-cols-2 sm:px-7 lg:grid-cols-[1.35fr_repeat(3,0.7fr)] lg:items-center">
              <div className="flex items-baseline gap-3"><p className="font-mono text-3xl font-black tracking-tight">{money(dashboard.account.equity)}</p><span className="text-xs font-semibold text-zinc-600">Portfolio</span></div>
              <AccountMetric label="Buying power" value={money(dashboard.account.buyingPower)} />
              <AccountMetric label="Realized P&L" value={money(dashboard.account.realizedPnl)} tone={dashboard.account.realizedPnl >= 0 ? "text-green-300" : "text-red-300"} />
              <AccountMetric label="Available cash" value={money(dashboard.account.cashBalance)} />
            </section>

            {(instrumentError || message) && <div className={`border-b px-5 py-3 text-xs font-semibold sm:px-7 ${instrumentError ? "border-red-400/15 bg-red-500/[0.05] text-red-300" : "border-cyan-400/10 bg-cyan-500/[0.03] text-zinc-400"}`} role="status">{instrumentError || message}</div>}

            <section className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="order-2 min-w-0 px-5 py-6 sm:px-7 lg:order-1">
                <div className="min-h-12">
                  {instrument?.symbol === ticket.symbol ? <div className="flex flex-wrap items-end gap-x-4 gap-y-2"><h1 className="font-mono text-4xl font-black tracking-tight">{instrument.symbol}</h1><p className="pb-0.5 font-mono text-xl font-black text-zinc-300">{money(instrument.price)}</p><p className={`pb-1 text-sm font-black ${instrument.changePercent >= 0 ? "text-green-300" : "text-red-300"}`}>{instrument.changePercent >= 0 ? "+" : ""}{instrument.changePercent.toFixed(2)}%</p></div> : <div><h1 className="text-2xl font-black">Verified price chart</h1><p className="mt-1 text-xs font-semibold text-zinc-600">Choose a stock from the trade panel.</p></div>}
                </div>

                {instrumentLoading ? (
                  <div className="mt-5 flex h-[440px] animate-pulse items-center justify-center rounded-2xl bg-white/[0.015]"><p className="text-xs font-semibold text-zinc-700">Loading verified market data…</p></div>
                ) : instrument?.symbol === ticket.symbol ? (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3"><p className="text-[11px] font-semibold text-zinc-600">Current session · verified provider candles</p><div className="flex items-center gap-2 text-[10px] font-semibold"><span className="rounded-full bg-cyan-500/[0.07] px-3 py-1.5 text-cyan-300">{instrument.marketSession.replace("_", " ")}</span><span className="text-zinc-700">Quote age {instrument.quoteAgeMinutes.toFixed(1)}m</span></div></div>
                    <HeroPriceChart asset="stock" symbol={instrument.symbol} accent="cyan" height={330} />
                    <div className="mt-4 grid grid-cols-2 gap-y-4 border-t border-white/8 pt-4 sm:grid-cols-4">
                      <AccountMetric label="Open" value={money(instrument.sessionOpen || null)} />
                      <AccountMetric label="High" value={money(instrument.sessionHigh || null)} />
                      <AccountMetric label="Low" value={money(instrument.sessionLow || null)} />
                      <AccountMetric label="Volume" value={compactNumber(instrument.volume)} />
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 flex h-[440px] flex-col items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_50%_40%,rgba(251,146,60,0.06),transparent_34%)] px-5 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/[0.08] font-mono text-lg font-black text-orange-300">HT</div>
                    <h2 className="mt-5 text-2xl font-black">Search a ticker to start</h2>
                    <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-zinc-600">The verified chart and paper order controls will appear here.</p>
                  </div>
                )}
              </div>

              <aside className="order-1 border-b border-white/8 bg-[#0a0d0e] px-5 py-6 sm:px-6 lg:order-2 lg:border-b-0 lg:border-l">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">Paper trade</p>
                    <h2 className="mt-1 text-xl font-black">{instrument?.symbol === ticket.symbol ? instrument.symbol : "Choose a stock"}</h2>
                  </div>
                  <span className="rounded-full border border-green-400/15 bg-green-500/[0.06] px-3 py-1.5 text-[9px] font-black text-green-300">SIMULATION</span>
                </div>
                <div className="mt-5 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-[#0d1112] p-1.5 focus-within:border-orange-400/35">
                  <span className="pl-2 text-orange-300">⌕</span>
                  <input value={ticket.symbol} onChange={(event) => { setTicket({ ...ticket, symbol: event.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10), closePosition: false }); setReviewing(false); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void lookupInstrument(ticket.symbol); } }} placeholder="Search ticker" aria-label="Stock ticker" className="min-w-0 flex-1 bg-transparent px-1 py-2 font-mono text-sm font-black outline-none placeholder:font-sans placeholder:font-semibold placeholder:text-zinc-700" />
                  <button type="button" onClick={() => void lookupInstrument(ticket.symbol)} disabled={instrumentLoading || !ticket.symbol} className="rounded-lg bg-orange-500 px-3 py-2.5 text-[10px] font-black text-black disabled:opacity-35">{instrumentLoading ? "Checking" : "Load"}</button>
                </div>
                {recentSymbols.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{recentSymbols.map((symbol) => <button key={symbol} onClick={() => void lookupInstrument(symbol)} className="rounded-lg border border-white/8 px-2.5 py-1.5 font-mono text-[9px] font-black text-zinc-600 transition hover:border-white/15 hover:text-white">{symbol}</button>)}</div>}
                {instrument?.symbol !== ticket.symbol ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center text-center"><p className="text-sm font-black text-zinc-500">Search and load a ticker</p><p className="mt-2 max-w-[230px] text-xs font-semibold leading-5 text-zinc-700">Its live quote, chart, and available actions will appear here.</p></div>
                ) : (
                  <>
                    {instrument.position && (
                      <div className="mt-5 overflow-hidden rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.035]">
                        <div className="flex items-start justify-between gap-3 px-4 py-3.5">
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-cyan-300">Your {instrument.position.side} position</p>
                            <p className="mt-1 font-mono text-base font-black">{amount(instrument.position.quantity)} shares <span className="text-xs text-zinc-600">@ {money(instrument.position.averageEntryPrice)}</span></p>
                          </div>
                          <div className="text-right">
                            <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Open P&amp;L</p>
                            <p className={`mt-1 font-mono text-sm font-black ${(instrument.position.unrealizedPnl ?? 0) >= 0 ? "text-green-300" : "text-red-300"}`}>{money(instrument.position.unrealizedPnl)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-px border-t border-cyan-400/10 bg-cyan-400/10">
                          {([0.25, 0.5, 1] as const).map((fraction) => (
                            <button key={fraction} type="button" onClick={() => preparePositionClose(instrument.position!, fraction, true)} className={`bg-[#091011] py-3 text-[10px] font-black transition hover:bg-orange-500/[0.08] hover:text-orange-300 ${fraction === 1 ? "text-orange-300" : "text-zinc-400"}`}>
                              {fraction === 1 ? (instrument.position!.side === "long" ? "Sell all" : "Cover all") : `${fraction * 100}%`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-5">
                      <p className="mb-2 text-[9px] font-black uppercase tracking-[0.15em] text-zinc-600">Choose action</p>
                      <div className={`grid gap-1 rounded-xl bg-white/[0.035] p-1 ${availableSides.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
                        {availableSides.map((side) => <button key={side} type="button" onClick={() => selectOrderSide(side)} className={`rounded-lg px-2 py-3 text-[11px] font-black transition ${ticket.side === side ? (side === "buy" || side === "buy_to_cover" ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300") : "text-zinc-600 hover:text-zinc-300"}`}>{side === "buy" && instrument.position?.side === "long" ? "Buy more" : side === "sell_short" && instrument.position?.side === "short" ? "Short more" : sideLabels[side]}</button>)}
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      <Field label="Order type" detail={ticket.timeInForce.toUpperCase()}><select value={ticket.orderType} onChange={(event) => { setTicket({ ...ticket, orderType: event.target.value as PaperOrderType }); setReviewing(false); }} className="w-full rounded-xl border border-white/10 bg-[#0e1213] px-4 py-3 text-sm font-bold outline-none focus:border-orange-400/35"><option value="market">Market order</option><option value="limit">Limit order</option><option value="stop">Stop order</option><option value="stop_limit">Stop-limit order</option></select></Field>
                      <Field label="Order size" detail={`Available ${money(dashboard.account.buyingPower)}`}>
                        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.025] p-1">
                          {(["dollars", "shares"] as SizingMode[]).map((mode) => <button key={mode} type="button" onClick={() => selectSizingMode(mode)} className={`rounded-md py-2 text-[9px] font-black capitalize ${sizingMode === mode ? "bg-white/[0.07] text-white" : "text-zinc-600"}`}>{mode}</button>)}
                        </div>
                        <div className="flex items-center rounded-xl border border-white/10 bg-[#0e1213] px-4 focus-within:border-orange-400/35">
                          <span className={`text-sm font-black text-zinc-600 ${sizingMode === "dollars" ? "block" : "hidden"}`}>$</span>
                          <input type="number" min="0" step={sizingMode === "dollars" ? "1" : ticket.side === "sell_short" ? "1" : "0.00000001"} value={sizingMode === "dollars" ? dollarAmount : ticket.quantity} onChange={(event) => sizingMode === "dollars" ? setDollars(event.target.value) : setShares(event.target.value)} placeholder="0" className="min-w-0 flex-1 bg-transparent py-3 pl-1 font-mono text-sm font-black outline-none" />
                          <span className="text-xs font-semibold text-zinc-600">{sizingMode}</span>
                        </div>
                        {sizingMode === "dollars" && (ticket.side === "buy" || ticket.side === "sell_short") && (
                          <div className="mt-2 grid grid-cols-4 gap-1.5">
                            {([0.1, 0.25, 0.5, 1] as const).map((fraction) => <button key={fraction} type="button" onClick={() => applyBuyingPowerPercent(fraction)} className="rounded-lg border border-white/8 bg-white/[0.025] py-2 text-[9px] font-black text-zinc-500 transition hover:border-orange-400/20 hover:text-orange-300">{fraction * 100}%</button>)}
                          </div>
                        )}
                        {instrument.position && (
                          (ticket.side === "sell" && instrument.position.side === "long") ||
                          (ticket.side === "buy_to_cover" && instrument.position.side === "short")
                        ) && (
                          <div className="mt-2 grid grid-cols-3 gap-1.5">
                            {([0.25, 0.5, 1] as const).map((fraction) => (
                              <button
                                key={fraction}
                                type="button"
                                onClick={() => preparePositionClose(instrument.position!, fraction)}
                                className="rounded-lg border border-white/8 bg-white/[0.025] py-2 text-[9px] font-black text-zinc-500 transition hover:border-orange-400/20 hover:text-orange-300"
                              >
                                {fraction === 1 ? "All" : `${fraction * 100}%`}
                              </button>
                            ))}
                          </div>
                        )}
                      </Field>
                      {(ticket.orderType === "limit" || ticket.orderType === "stop_limit") && <Field label="Limit price"><input type="number" min="0" step="0.01" value={ticket.limitPrice} onChange={(event) => { setTicket({ ...ticket, limitPrice: event.target.value }); setReviewing(false); }} className="w-full rounded-xl border border-white/10 bg-[#0e1213] px-4 py-3 font-mono text-sm font-black outline-none focus:border-orange-400/35" /></Field>}
                      {(ticket.orderType === "stop" || ticket.orderType === "stop_limit") && <Field label="Stop price"><input type="number" min="0" step="0.01" value={ticket.stopPrice} onChange={(event) => { setTicket({ ...ticket, stopPrice: event.target.value }); setReviewing(false); }} className="w-full rounded-xl border border-white/10 bg-[#0e1213] px-4 py-3 font-mono text-sm font-black outline-none focus:border-orange-400/35" /></Field>}
                      {orderImpact && (
                        <OrderEstimate
                          impact={orderImpact}
                          side={ticket.side}
                          dataMode={instrument.dataMode}
                        />
                      )}
                    </div>

                    <details className="mt-5 border-y border-white/8 py-4 text-xs text-zinc-500">
                      <summary className="cursor-pointer font-bold text-zinc-400">Advanced order controls</summary>
                      <div className="mt-4 space-y-4">
                        <Field label="Time in force"><select value={ticket.timeInForce} onChange={(event) => { setTicket({ ...ticket, timeInForce: event.target.value as PaperTimeInForce }); setReviewing(false); }} className="w-full rounded-xl border border-white/10 bg-[#0e1213] px-4 py-3 text-sm font-bold outline-none"><option value="day">Day</option><option value="gtc">Good till cancelled</option></select></Field>
                        <label className="flex items-center justify-between gap-3 font-semibold"><span>Extended-hours simulation</span><input type="checkbox" checked={ticket.allowExtendedHours} onChange={(event) => { setTicket({ ...ticket, allowExtendedHours: event.target.checked }); setReviewing(false); }} className="h-4 w-4 accent-orange-500" /></label>
                        {(ticket.side === "buy" || ticket.side === "sell_short") && <label className="flex items-center justify-between gap-3 font-semibold"><span>Take-profit + stop-loss</span><input type="checkbox" checked={ticket.bracket} onChange={(event) => { setTicket({ ...ticket, bracket: event.target.checked }); setReviewing(false); }} className="h-4 w-4 accent-orange-500" /></label>}
                        {ticket.bracket && <div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" aria-label="Take profit price" placeholder="Take profit" value={ticket.takeProfitPrice} onChange={(event) => setTicket({ ...ticket, takeProfitPrice: event.target.value })} className="min-w-0 rounded-xl border border-white/10 bg-[#0e1213] px-3 py-3 font-mono text-xs font-black outline-none" /><input type="number" min="0" step="0.01" aria-label="Stop loss price" placeholder="Stop loss" value={ticket.stopLossPrice} onChange={(event) => setTicket({ ...ticket, stopLossPrice: event.target.value })} className="min-w-0 rounded-xl border border-white/10 bg-[#0e1213] px-3 py-3 font-mono text-xs font-black outline-none" /></div>}
                      </div>
                    </details>

                    <div className="mt-5 space-y-2 text-xs"><div className="flex justify-between gap-3 text-zinc-600"><span>Verified quote</span><strong className="font-mono text-zinc-300">{money(instrument.price)}</strong></div><div className="flex justify-between gap-3 text-zinc-600"><span>Market session</span><strong className="capitalize text-zinc-300">{instrument.marketSession.replace("_", " ")}</strong></div></div>

                    {reviewing ? <div className="mt-5 rounded-xl border border-orange-400/15 bg-orange-500/[0.07] p-4"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-300">Final review</p><p className="mt-2 font-mono text-lg font-black">{sideLabels[ticket.side]} {amount(Number(ticket.quantity))} {ticket.symbol}</p><p className="mt-1 text-xs font-semibold text-zinc-600">{ticket.orderType.replace("_", " ")} · {ticket.timeInForce.toUpperCase()} · paper money</p>{orderImpact && <div className="mt-3 space-y-1.5 border-t border-orange-300/10 pt-3 text-[10px] font-semibold"><div className="flex justify-between gap-3 text-zinc-500"><span>{ticket.side === "sell" ? "Estimated proceeds" : ticket.side === "buy_to_cover" ? "Estimated cover value" : "Estimated order value"}</span><strong className="font-mono text-white">{money(orderImpact.estimatedNotional)}</strong></div><div className="flex justify-between gap-3 text-zinc-500"><span>Buying power after</span><strong className={`font-mono ${orderImpact.buyingPowerAfter >= 0 ? "text-green-300" : "text-red-300"}`}>{money(orderImpact.buyingPowerAfter)}</strong></div></div>}<div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => setReviewing(false)} disabled={submitting} className="rounded-xl border border-white/10 px-4 py-3 text-xs font-black">Edit</button><button onClick={() => void submit()} disabled={submitting} className="rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-black disabled:opacity-50">{submitting ? "Submitting…" : `Confirm ${sideLabels[ticket.side]}`}</button></div></div> : <button onClick={() => setReviewing(true)} disabled={!ticketReady} className="mt-5 w-full rounded-xl bg-orange-500 px-5 py-3.5 text-sm font-black text-black shadow-[0_0_24px_rgba(251,146,60,0.12)] disabled:cursor-not-allowed disabled:opacity-35">{ticketReady ? `Review ${sideLabels[ticket.side]} order` : "Enter an amount to continue"}</button>}
                    <p className="mt-3 text-center text-[10px] font-semibold text-zinc-700">Simulation only · no live broker connection</p>
                  </>
                )}
              </aside>
            </section>

            <section className="border-t border-white/8">
              <div className="flex min-w-0 overflow-x-auto border-b border-white/8 px-4 sm:px-6">
                {([['positions', 'Positions', dashboard.positions.length], ['orders', 'Open orders', openOrders.length], ['fills', 'Fills', dashboard.fills.length], ['history', 'History', dashboard.orders.length]] as const).map(([tab, label, count]) => <button key={tab} onClick={() => setActivityTab(tab)} className={`whitespace-nowrap border-b-2 px-3 py-4 text-[11px] font-bold transition ${activityTab === tab ? "border-orange-400 text-white" : "border-transparent text-zinc-600 hover:text-zinc-300"}`}>{label} <span className="ml-1 font-mono text-zinc-700">{count}</span></button>)}
              </div>
              <div className="max-h-[340px] min-h-[120px] overflow-auto px-5 py-4 sm:px-7">
                {activityTab === "positions" && (dashboard.positions.length === 0 ? <div className="flex min-h-20 items-center justify-center text-sm font-semibold text-zinc-700">No open positions yet.</div> : <div className="space-y-2">{dashboard.positions.map((position) => <div key={position.id} className="grid items-center gap-3 rounded-xl bg-white/[0.025] px-4 py-3 sm:grid-cols-[1.1fr_0.8fr_0.8fr_1fr_auto]"><button onClick={() => void lookupInstrument(position.symbol)} className="text-left font-mono text-sm font-black hover:text-orange-300">{position.symbol} <span className="ml-1 text-[9px] uppercase text-zinc-600">{position.side}</span></button><p className="font-mono text-xs text-zinc-400">{amount(position.quantity)} shares</p><p className="font-mono text-xs text-zinc-400">Avg {money(position.averageEntryPrice)}</p><p className={`font-mono text-xs font-black ${(position.unrealizedPnl ?? 0) >= 0 ? "text-green-300" : "text-red-300"}`}>{money(position.unrealizedPnl)} {position.unrealizedPnlPercent === null ? "" : `(${position.unrealizedPnlPercent.toFixed(1)}%)`}</p><button onClick={() => closePosition(position)} className="rounded-lg border border-orange-400/20 bg-orange-500/[0.05] px-3 py-2 text-[10px] font-black text-orange-300">Review close</button></div>)}</div>)}
                {activityTab === "orders" && (openOrders.length === 0 ? <div className="flex min-h-20 items-center justify-center text-sm font-semibold text-zinc-700">No open orders.</div> : <div className="space-y-2">{openOrders.map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-4 py-3"><div><p className="font-mono text-sm font-black">{order.symbol} · {sideLabels[order.side]} {amount(order.quantity)}</p><p className="mt-1 text-[10px] font-semibold text-zinc-600">{order.orderType.replace("_", " ")} {order.limitPrice ? `@ ${money(order.limitPrice)}` : ""}</p></div><div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase ${orderTone(order.status)}`}>{order.status}</span><button onClick={() => void cancel(order.id)} className="rounded-lg border border-red-400/20 px-3 py-2 text-[9px] font-black text-red-300">Cancel</button></div></div>)}</div>)}
                {activityTab === "fills" && (dashboard.fills.length === 0 ? <div className="flex min-h-20 items-center justify-center text-sm font-semibold text-zinc-700">No fills yet.</div> : <div className="grid gap-2 lg:grid-cols-2">{dashboard.fills.slice(0, 12).map((fill) => <div key={fill.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-4 py-3"><div><p className="font-mono text-sm font-black">{fill.symbol} · {sideLabels[fill.side]}</p><p className="mt-1 text-[10px] text-zinc-600">{new Date(fill.filledAt).toLocaleString()}</p></div><p className="font-mono text-xs font-black">{amount(fill.quantity)} @ {money(fill.price)}</p></div>)}</div>)}
                {activityTab === "history" && (dashboard.orders.length === 0 ? <div className="flex min-h-20 items-center justify-center text-sm font-semibold text-zinc-700">No order history yet.</div> : <div className="grid gap-2 lg:grid-cols-2">{dashboard.orders.slice(0, 12).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-4 py-3"><div><p className="font-mono text-sm font-black">{order.symbol} · {sideLabels[order.side]}</p><p className="mt-1 text-[10px] text-zinc-600">{order.orderType.replace("_", " ")} · {amount(order.quantity)} shares</p></div><span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase ${orderTone(order.status)}`}>{order.status}</span></div>)}</div>)}
              </div>
            </section>

            <footer className="border-t border-white/8 px-5 py-4 text-[10px] font-semibold leading-5 text-zinc-700 sm:px-7">{dashboard.disclosure} HT Paper is educational simulation software. No order is routed to a live broker.</footer>
          </>
        )}
      </div>
    </main>
  );
}
