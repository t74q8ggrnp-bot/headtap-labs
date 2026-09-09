import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { authenticatePaperRequest } from "@/lib/paper-trading/server";
import { CRYPTO_PAPER_CONTRACT, parseCryptoPaperIntent, validCryptoPaperUuid } from "@/lib/crypto/paper-contracts";
import { CryptoPaperError, cancelCryptoPaper, openCryptoPaper, previewCryptoPaper, previewCryptoPaperBudget, readCryptoPaper, submitCryptoPaper } from "@/lib/crypto/paper-server";
import { withCryptoCapabilities } from "@/lib/crypto/product-capabilities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: Request) {
  const rate = checkApiRateLimit(request, { namespace:`crypto-paper-${request.method}`, limit:30, windowMs:60_000 });
  const headers = { "Cache-Control":"private, no-store", ...rate.headers };
  const respond = (value: object, status = 200) => Response.json({contractVersion:CRYPTO_PAPER_CONTRACT,...value},{status,headers});
  if (!rate.allowed) return respond({ok:false,error:"Too many requests. Please wait a moment."},429);
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return respond({ok:false,error:"Sign in to use your private crypto paper account."},401);
    const user = context.user.id;
    if (request.method === "GET") return respond({ok:true,dashboard:await readCryptoPaper(user)});
    const input = await request.json().catch(()=>null);
    if (!input || typeof input !== "object" || Array.isArray(input)) return respond({ok:false,error:"Invalid request."},400);
    if (input.action === "open_account") return respond(await openCryptoPaper(user));
    if (input.action === "cancel") {
      if (!validCryptoPaperUuid(input.orderId)) return respond({ok:false,error:"Invalid order ID."},400);
      return respond(await cancelCryptoPaper(user,input.orderId));
    }
    if (input.action === "preview" && input.side === "buy" && typeof input.amountDollars === "string") {
      const sized = parseCryptoPaperIntent({...input,quantity:"1"});
      if (!sized || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(input.amountDollars) || Number(input.amountDollars)<=0) {
        return respond({ok:false,error:"Enter a positive USD amount and price limit."},400);
      }
      return respond({ok:true,preview:await previewCryptoPaperBudget(user,sized.marketId,input.amountDollars,sized.limitPrice)});
    }
    const intent = parseCryptoPaperIntent(input);
    if (!intent) return respond({ok:false,error:"Choose an exact USD market, buy or sell, quantity and price limit."},400);
    if (input.action === "preview") return respond({ok:true,preview:await previewCryptoPaper(user,intent)});
    if (input.action === "submit" && validCryptoPaperUuid(input.clientId) && validCryptoPaperUuid(input.previewCycleId)) {
      return respond(await submitCryptoPaper(user,intent,input.clientId,input.previewCycleId),201);
    }
    return respond({ok:false,error:"Review the order before confirming it."},400);
  } catch (error) {
    return respond({ok:false,error:error instanceof CryptoPaperError ? error.message : "Crypto paper trading is temporarily unavailable."},
      error instanceof CryptoPaperError ? error.status : 503);
  }
}

export const GET = withCryptoCapabilities("publicApiEnabled", handle);
export const POST = withCryptoCapabilities(
  ["publicApiEnabled", "paperOrderEntryEnabled"],
  handle,
);
