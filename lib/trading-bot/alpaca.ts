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
