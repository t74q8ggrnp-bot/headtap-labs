import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { readBearerToken } from "@/lib/account-deletion";
import { getPaperTradingQuote } from "./quote";
import {
  markPaperPortfolio,
  type PaperAccount,
  type PaperOrderIntent,
  type PaperPosition,
} from "./engine";
import type {
  PaperDashboard,
  PaperFillView,
  PaperOrderView,
  PaperPositionView,
} from "./contracts";

export type PaperServerContext = {
  user: User;
  service: SupabaseClient;
};

type AccountRow = {
  id: string;
  user_id: string;
  name: string;
  starting_cash: number | string;
  cash_balance: number | string;
  realized_pnl: number | string;
  short_margin_held: number | string;
  margin_enabled: boolean;
  data_mode: "delayed" | "real_time";
};

export type PositionRow = {
  id: string;
  symbol: string;
  quantity: number | string;
  average_entry_price: number | string;
  realized_pnl: number | string;
  short_margin_held: number | string;
};

type OrderRow = {
  id: string;
  symbol: string;
  side: PaperOrderView["side"];
  order_type: PaperOrderView["orderType"];
  time_in_force: PaperOrderView["timeInForce"];
  quantity: number | string;
  filled_quantity: number | string;
  limit_price: number | string | null;
  stop_price: number | string | null;
  status: string;
  allow_extended_hours: boolean;
  submitted_at: string;
  filled_at: string | null;
  reject_reason: string | null;
  strategy_source: string;
};

type FillRow = {
  id: string;
  order_id: string;
  symbol: string;
  side: PaperFillView["side"];
  quantity: number | string;
  price: number | string;
  notional: number | string;
  slippage_bps: number | string;
  quote_source: string;
  quote_timestamp: string;
  filled_at: string;
};

const number = (value: number | string | null | undefined) => Number(value ?? 0);

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  )?.trim();
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Paper trading database credentials are not configured.");
  }
  return { url, anonKey, serviceKey };
}

export async function authenticatePaperRequest(
  request: Request,
): Promise<PaperServerContext | null> {
  const accessToken = readBearerToken(request.headers.get("authorization"));
  if (!accessToken) return null;
  const { url, anonKey, serviceKey } = credentials();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return {
    user: data.user,
    service: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
}

export function getPaperServiceClient(): SupabaseClient {
  const { url, serviceKey } = credentials();
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function getOrCreatePaperAccount(
  context: PaperServerContext,
): Promise<AccountRow> {
  const existing = await context.service
    .from("paper_accounts")
    .select("id,user_id,name,starting_cash,cash_balance,realized_pnl,short_margin_held,margin_enabled,data_mode")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as AccountRow;

  const created = await context.service
    .from("paper_accounts")
    .insert({ user_id: context.user.id })
    .select("id,user_id,name,starting_cash,cash_balance,realized_pnl,short_margin_held,margin_enabled,data_mode")
    .single();
  if (created.error) {
    // A duplicate can occur if two tabs create the one-per-user account at
    // the same time. Read the winning row instead of creating a second ledger.
    if (created.error.code === "23505") {
      const retry = await context.service
        .from("paper_accounts")
        .select("id,user_id,name,starting_cash,cash_balance,realized_pnl,short_margin_held,margin_enabled,data_mode")
        .eq("user_id", context.user.id)
        .single();
      if (retry.error) throw retry.error;
      return retry.data as AccountRow;
    }
    throw created.error;
  }
  const row = created.data as AccountRow;
  const ledger = await context.service.from("paper_ledger_entries").insert({
    account_id: row.id,
    user_id: context.user.id,
    entry_type: "account_open",
    cash_balance_after: number(row.cash_balance),
    metadata: { starting_cash: number(row.starting_cash) },
  });
  if (ledger.error) throw ledger.error;
  return row;
}

export function accountState(row: AccountRow): PaperAccount {
  return {
    cashBalance: number(row.cash_balance),
    shortMarginHeld: number(row.short_margin_held),
    marginEnabled: row.margin_enabled,
  };
}

export function positionState(row: PositionRow | null): PaperPosition | null {
  return row ? {
    quantity: number(row.quantity),
    averageEntryPrice: number(row.average_entry_price),
    shortMarginHeld: number(row.short_margin_held),
  } : null;
}

export async function findPaperPosition(
  service: SupabaseClient,
  accountId: string,
  symbol: string,
): Promise<PositionRow | null> {
  const result = await service
    .from("paper_positions")
    .select("id,symbol,quantity,average_entry_price,realized_pnl,short_margin_held")
    .eq("account_id", accountId)
    .eq("symbol", symbol)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as PositionRow | null;
}

export async function createBracketChildren(
  service: SupabaseClient,
  parent: {
    id: string;
    account_id: string;
    user_id: string;
    symbol: string;
    asset_type: string;
    side: "buy" | "sell_short";
    quantity: number | string;
    time_in_force: "day" | "gtc";
    allow_extended_hours: boolean;
    bracket_take_profit_price: number | string;
    bracket_stop_loss_price: number | string;
    strategy_source: PaperOrderIntent["strategySource"];
    data_mode: "delayed" | "real_time";
  },
): Promise<void> {
  const existing = await service
    .from("paper_orders")
    .select("id")
    .eq("parent_order_id", parent.id)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length > 0) return;
  const ocoGroupId = crypto.randomUUID();
  const closingSide = parent.side === "buy" ? "sell" : "buy_to_cover";
  const common = {
    account_id: parent.account_id,
    user_id: parent.user_id,
    symbol: parent.symbol,
    asset_type: parent.asset_type,
    side: closingSide,
    time_in_force: parent.time_in_force,
    quantity: number(parent.quantity),
    allow_extended_hours: parent.allow_extended_hours,
    status: "open",
    order_class: "bracket_child",
    parent_order_id: parent.id,
    oco_group_id: ocoGroupId,
    reduce_only: true,
    strategy_source: parent.strategy_source,
    data_mode: parent.data_mode,
  };
  const result = await service.from("paper_orders").insert([
    { ...common, order_type: "limit", limit_price: number(parent.bracket_take_profit_price) },
    { ...common, order_type: "stop", stop_price: number(parent.bracket_stop_loss_price) },
  ]);
  if (result.error) throw result.error;
}

export async function loadPaperDashboard(
  context: PaperServerContext,
): Promise<PaperDashboard> {
  const account = await getOrCreatePaperAccount(context);
  const [positionsResult, ordersResult, fillsResult] = await Promise.all([
    context.service
      .from("paper_positions")
      .select("id,symbol,quantity,average_entry_price,realized_pnl,short_margin_held")
      .eq("account_id", account.id)
      .neq("quantity", 0)
      .order("updated_at", { ascending: false }),
    context.service
      .from("paper_orders")
      .select("id,symbol,side,order_type,time_in_force,quantity,filled_quantity,limit_price,stop_price,status,allow_extended_hours,submitted_at,filled_at,reject_reason,strategy_source")
      .eq("account_id", account.id)
      .order("submitted_at", { ascending: false })
      .limit(100),
    context.service
      .from("paper_fills")
      .select("id,order_id,symbol,side,quantity,price,notional,slippage_bps,quote_source,quote_timestamp,filled_at")
      .eq("account_id", account.id)
      .order("filled_at", { ascending: false })
      .limit(100),
  ]);
  if (positionsResult.error) throw positionsResult.error;
  if (ordersResult.error) throw ordersResult.error;
  if (fillsResult.error) throw fillsResult.error;

  const positionRows = (positionsResult.data ?? []) as PositionRow[];
  const quotePairs = await Promise.all(positionRows.map(async (position) => {
    try {
      return [position.symbol, await getPaperTradingQuote(position.symbol)] as const;
    } catch {
      return [position.symbol, null] as const;
    }
  }));
  const quotes = new Map(quotePairs);
  const positions: PaperPositionView[] = positionRows.map((position) => {
    const quantity = number(position.quantity);
    const averageEntryPrice = number(position.average_entry_price);
    const quote = quotes.get(position.symbol);
    const unrealizedPnl = quote
      ? quantity > 0
        ? (quote.price - averageEntryPrice) * quantity
        : (averageEntryPrice - quote.price) * Math.abs(quantity)
      : null;
    const costBasis = averageEntryPrice * Math.abs(quantity);
    return {
      id: position.id,
      symbol: position.symbol,
      side: quantity > 0 ? "long" : "short",
      quantity: Math.abs(quantity),
      averageEntryPrice,
      shortMarginHeld: number(position.short_margin_held),
      currentPrice: quote?.price ?? null,
      marketValue: quote ? Math.abs(quantity) * quote.price : null,
      unrealizedPnl,
      unrealizedPnlPercent: unrealizedPnl !== null && costBasis > 0
        ? unrealizedPnl / costBasis * 100
        : null,
      realizedPnl: number(position.realized_pnl),
      quoteTimestamp: quote?.timestamp ?? null,
    };
  });
  const marked = markPaperPortfolio(accountState(account), positionRows.flatMap((position) => {
    const quote = quotes.get(position.symbol);
    if (!quote) return [];
    return [{
      quantity: number(position.quantity),
      averageEntryPrice: number(position.average_entry_price),
      shortMarginHeld: number(position.short_margin_held),
      price: quote.price,
    }];
  }));

  const orders: PaperOrderView[] = ((ordersResult.data ?? []) as OrderRow[]).map((order) => ({
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    orderType: order.order_type,
    timeInForce: order.time_in_force,
    quantity: number(order.quantity),
    filledQuantity: number(order.filled_quantity),
    limitPrice: order.limit_price === null ? null : number(order.limit_price),
    stopPrice: order.stop_price === null ? null : number(order.stop_price),
    status: order.status,
    allowExtendedHours: order.allow_extended_hours,
    submittedAt: order.submitted_at,
    filledAt: order.filled_at,
    rejectReason: order.reject_reason,
    strategySource: order.strategy_source,
  }));
  const fills: PaperFillView[] = ((fillsResult.data ?? []) as FillRow[]).map((fill) => ({
    id: fill.id,
    orderId: fill.order_id,
    symbol: fill.symbol,
    side: fill.side,
    quantity: number(fill.quantity),
    price: number(fill.price),
    notional: number(fill.notional),
    slippageBps: number(fill.slippage_bps),
    quoteSource: fill.quote_source,
    quoteTimestamp: fill.quote_timestamp,
    filledAt: fill.filled_at,
  }));

  return {
    account: {
      id: account.id,
      name: account.name,
      startingCash: number(account.starting_cash),
      cashBalance: number(account.cash_balance),
      realizedPnl: number(account.realized_pnl),
      shortMarginHeld: number(account.short_margin_held),
      equity: marked.equity,
      buyingPower: marked.buyingPower,
      longMarketValue: marked.longMarketValue,
      shortUnrealizedPnl: marked.shortUnrealizedPnl,
      dataMode: account.data_mode,
    },
    positions,
    orders,
    fills,
    disclosure: account.data_mode === "delayed"
      ? "Simulation only. Quotes and fills use delayed market data and may differ materially from executable market prices."
      : "Simulation only. Paper fills may differ from executable market prices.",
    generatedAt: new Date().toISOString(),
  };
}
