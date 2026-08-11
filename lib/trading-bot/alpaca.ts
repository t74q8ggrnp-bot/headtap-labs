// lib/trading-bot/alpaca.ts
//
// Thin Alpaca paper-trading client. Hardcoded to the paper base URL —
// there is no live-trading path anywhere in this file. Flipping this bot
// to real money would require deliberately changing this URL and the
// credentials it reads, not a config toggle.

const ALPACA_BASE_URL = "https://paper-api.alpaca.markets";
const ALPACA_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY;

export function alpacaConfigured(): boolean {
  return Boolean(ALPACA_KEY && ALPACA_SECRET);
}

async function alpacaFetch(path: string, init?: RequestInit) {
  if (!ALPACA_KEY || !ALPACA_SECRET) {
    throw new Error("Missing ALPACA_API_KEY / ALPACA_SECRET_KEY.");
  }
  const res = await fetch(`${ALPACA_BASE_URL}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": ALPACA_KEY,
      "APCA-API-SECRET-KEY": ALPACA_SECRET,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
};

export async function getAccount() {
  return alpacaFetch("/v2/account");
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaFetch("/v2/positions");
}

export async function placeBuyNotional(ticker: string, notional: number) {
  return alpacaFetch("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: ticker,
      notional: notional.toFixed(2),
      side: "buy",
      type: "market",
      time_in_force: "day",
    }),
  });
}

export async function placeBuyQty(ticker: string, qty: number) {
  return alpacaFetch("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: ticker,
      qty: qty.toString(),
      side: "buy",
      type: "market",
      time_in_force: "day",
    }),
  });
}

export async function placeSellQty(ticker: string, qty: string) {
  return alpacaFetch("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: ticker,
      qty,
      side: "sell",
      type: "market",
      time_in_force: "day",
    }),
  });
}

export type AlpacaOrder = { id: string; status: string; filled_avg_price: string | null; filled_qty: string | null };

export async function getOrder(orderId: string): Promise<AlpacaOrder> {
  return alpacaFetch(`/v2/orders/${orderId}`);
}

// Best-effort cleanup for an order that never confirmed filled within the
// poll window (see pollForFill) — clears it so a retry next cycle doesn't
// collide with a stale pending order. Swallow failures here (a 404 just
// means it's already filled/cancelled/expired on Alpaca's side) — but the
// caller MUST re-check the order's real status after calling this, via
// getOrder, rather than assume the cancel means the order never filled.
// Confirmed live: an order can fill in the gap between the last poll
// attempt and this cancel call — the cancel then either 404s (too late,
// already filled) or "succeeds" on Alpaca's side while the fill still
// posts moments later. Either way, a real position exists on Alpaca that
// this function alone gives the caller no way to detect.
export async function cancelOrder(orderId: string): Promise<void> {
  try {
    await alpacaFetch(`/v2/orders/${orderId}`, { method: "DELETE" });
  } catch {
    // best-effort
  }
}
