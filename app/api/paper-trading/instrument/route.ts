import { NextResponse } from "next/server";
import {
  getEasternMarketSession,
  PAPER_TRADING_CONTRACT_VERSION,
  paperQuoteAgeMinutes,
  simulatedBorrowTerms,
} from "@/lib/paper-trading/engine";
import { getPaperTradingQuote } from "@/lib/paper-trading/quote";
import {
  authenticatePaperRequest,
  findPaperPosition,
  getOrCreatePaperAccount,
} from "@/lib/paper-trading/server";
import type { PaperPositionView } from "@/lib/paper-trading/contracts";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

const response = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json({ contractVersion: PAPER_TRADING_CONTRACT_VERSION, ...body }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });

export async function GET(request: Request) {
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);
    const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase() ?? "";
    if (!SYMBOL_PATTERN.test(symbol)) {
      return response({ ok: false, error: "Enter a valid stock ticker." }, 400);
    }
    const account = await getOrCreatePaperAccount(context);
    const [quote, positionRow] = await Promise.all([
      getPaperTradingQuote(symbol),
      findPaperPosition(context.service, account.id, symbol),
    ]);
    const borrow = simulatedBorrowTerms(quote);
    let position: PaperPositionView | null = null;
    if (positionRow && Number(positionRow.quantity) !== 0) {
      const signedQuantity = Number(positionRow.quantity);
      const quantity = Math.abs(signedQuantity);
      const averageEntryPrice = Number(positionRow.average_entry_price);
      const unrealizedPnl = signedQuantity > 0
        ? (quote.price - averageEntryPrice) * quantity
        : (averageEntryPrice - quote.price) * quantity;
      const costBasis = averageEntryPrice * quantity;
      position = {
        id: positionRow.id,
        symbol,
        side: signedQuantity > 0 ? "long" : "short",
        quantity,
        averageEntryPrice,
        shortMarginHeld: Number(positionRow.short_margin_held),
        currentPrice: quote.price,
        marketValue: quote.price * quantity,
        unrealizedPnl,
        unrealizedPnlPercent: costBasis > 0 ? unrealizedPnl / costBasis * 100 : null,
        realizedPnl: Number(positionRow.realized_pnl),
        quoteTimestamp: quote.timestamp,
      };
    }
    return response({
      ok: true,
      instrument: {
        symbol,
        price: quote.price,
        changePercent: quote.changePercent ?? 0,
        previousClose: quote.previousClose ?? 0,
        sessionOpen: quote.sessionOpen ?? 0,
        sessionHigh: quote.sessionHigh ?? 0,
        sessionLow: quote.sessionLow ?? 0,
        volume: quote.volume,
        quoteTimestamp: quote.timestamp,
        quoteAgeMinutes: Number(paperQuoteAgeMinutes(quote).toFixed(1)),
        quoteSource: quote.source,
        dataMode: quote.dataMode,
        marketSession: getEasternMarketSession(),
        borrowAvailable: borrow.available,
        borrowRatePercent: borrow.annualRatePercent,
        borrowReason: borrow.reason,
        position,
      },
    });
  } catch (error) {
    console.error("[manual-paper] instrument lookup failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return response({ ok: false, error: "Verified instrument data is temporarily unavailable." }, 502);
  }
}
