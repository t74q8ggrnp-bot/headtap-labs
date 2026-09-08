import { coinApiPilotService, readCoinApiPilot } from "./coinapi-pilot-server";
import { CRYPTO_PAPER_CONTRACT, type CryptoPaperDashboard, type CryptoPaperIntent, type CryptoPaperPreview } from "./paper-contracts";

export class CryptoPaperError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function storageError(error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0001") {
    // Only exceptions authored by the paper RPCs; no raw SQL, details or keys.
    const message = error.message ?? "The paper order could not be completed.";
    if (/^(Shared CoinAPI feed unavailable:|Open a crypto paper account first|Invalid crypto paper order|Enter a valid|Preview expired|Insufficient crypto paper|Sell quantity exceeds|Cancel an open order|Order not found|Crypto paper trading paused|Idempotency key reused)/.test(message)) {
      throw new CryptoPaperError(message);
    }
  }
  throw new CryptoPaperError(["42P01","42883","PGRST202","PGRST205"].includes(error?.code ?? "")
    ? "Crypto paper trading needs database migration 0040. No order was filled."
    : "Crypto paper storage is unavailable. Check order history before retrying with a new order.", 503);
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await coinApiPilotService().rpc(name, args);
  if (error || data === null) storageError(error);
  return data as T;
}

export async function openCryptoPaper(user: string) {
  return rpc<{ ok: boolean; created: boolean }>("ht_crypto_paper_open", { p_user:user });
}
export async function previewCryptoPaper(user: string, intent: CryptoPaperIntent) {
  return rpc<CryptoPaperPreview>("ht_crypto_paper_preview", {
    p_user:user, p_market:intent.marketId, p_side:intent.side, p_quantity:intent.quantity, p_limit:intent.limitPrice,
  });
}
export async function previewCryptoPaperBudget(user: string, market: string, amount: string, limit: string) {
  return rpc<CryptoPaperPreview>("ht_crypto_paper_preview_budget",{p_user:user,p_market:market,p_amount:amount,p_limit:limit});
}
export async function submitCryptoPaper(user: string, intent: CryptoPaperIntent, clientId: string, previewCycleId: string) {
  // The server and database recalculate availability; client preview totals are ignored.
  return rpc<{ok:boolean; orderId:string; status:string; duplicate:boolean}>("ht_crypto_paper_submit", {
    p_user:user, p_client:clientId, p_market:intent.marketId, p_side:intent.side,
    p_quantity:intent.quantity, p_limit:intent.limitPrice, p_preview_cycle:previewCycleId,
  });
}
export async function cancelCryptoPaper(user: string, orderId: string) {
  return rpc<{ok:boolean}>("ht_crypto_paper_cancel", { p_user:user, p_order:orderId });
}

type StoredDashboard = Pick<CryptoPaperDashboard,"account"|"enabled"|"reservedCash"|"orders"|"fills"> & {
  positions: Array<Pick<CryptoPaperDashboard["positions"][number],"market_id"|"quantity"|"available_quantity"|"cost_basis"|"updated_at">>;
};

/** Read-only: account, display and chart all use one shared saved publication. */
export async function readCryptoPaper(user: string): Promise<CryptoPaperDashboard> {
  const [stored, feed] = await Promise.all([
    rpc<StoredDashboard>("ht_crypto_paper_dashboard", { p_user:user }), readCoinApiPilot(),
  ]);
  const markets = new Map(feed.publication?.markets.map(market => [market.marketId,market]) ?? []);
  const positions = stored.positions.map(position => {
    const market = markets.get(position.market_id);
    const currentPrice = market?.price ?? null;
    const marketValue = currentPrice === null ? null : Number(position.quantity)*currentPrice;
    return { ...position, currentPrice, priceAsOf:market?.priceAsOf ?? null,
      current:market?.priceStatus === "current" && feed.status === "collecting",
      marketValue, unrealizedPnl:marketValue === null ? null : marketValue-Number(position.cost_basis) };
  });
  const completeMarks = positions.every(p => p.marketValue !== null);
  return { ...stored, contractVersion:CRYPTO_PAPER_CONTRACT, positions,
    buyingPower:stored.account ? Math.max(0,Number(stored.account.cash)-Number(stored.reservedCash)) : 0,
    equity:stored.account && completeMarks ? Number(stored.account.cash)+positions.reduce((sum,p)=>sum+p.marketValue!,0) : null,
    marksCurrent:positions.every(p=>p.current),
    feed:{ status:feed.status, reason:feed.budget.blocked_reason, publicationId:feed.publicationId, publication:feed.publication },
    realExecution:false, agentAutopilot:false };
}

/** Called only by the existing authenticated cron AFTER collection. No provider
 * calls, no trade proposals: fills only explicit outstanding user orders. */
export async function matchCryptoPaperOrders() {
  const db = coinApiPilotService();
  const started = Date.now();
  const { data, error } = await db.from("ht_crypto_paper_orders").select("id")
    .in("status",["open","partially_filled"]).order("submitted_at").limit(100);
  if (error) {
    // Rollout does not break the existing collector before additive SQL is installed.
    return { ok:false, schemaReady:!["42P01","PGRST205"].includes(error.code), processed:0, fills:0, providerRequests:0 };
  }
  let processed = 0, fills = 0;
  for (const order of data ?? []) {
    if (Date.now()-started >= 5_000) break;
    const { data: result, error: fillError } = await db.rpc("ht_crypto_paper_match",{p_order:order.id});
    if (fillError) return { ok:false, schemaReady:true, processed, fills, providerRequests:0 };
    processed++;
    if (result?.fillId) fills++;
  }
  return { ok:true, schemaReady:true, processed, fills, providerRequests:0 };
}
