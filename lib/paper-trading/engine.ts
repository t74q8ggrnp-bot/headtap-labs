export type PaperOrderSide =
  | "buy"
  | "sell"
  | "sell_short"
  | "buy_to_cover";

export type PaperOrderType = "market" | "limit" | "stop" | "stop_limit";
export type PaperTimeInForce = "day" | "gtc";

export type PaperOrderIntent = {
  symbol: string;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  timeInForce: PaperTimeInForce;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  allowExtendedHours: boolean;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  strategySource:
    | "manual"
    | "spot_momentum"
    | "before_crowd"
    | "scanner"
    | "ticker_detail";
};

export type PaperQuote = {
  symbol: string;
  price: number;
  timestamp: string;
  source: string;
  dataMode: "delayed" | "real_time";
  volume: number;
  previousVolume: number;
  previousClose?: number;
  sessionOpen?: number;
  sessionHigh?: number;
  sessionLow?: number;
  changePercent?: number;
};

export type PaperPosition = {
  quantity: number;
  averageEntryPrice: number;
  shortMarginHeld: number;
};

export type PaperAccount = {
  cashBalance: number;
  shortMarginHeld: number;
  marginEnabled: boolean;
};

export type MarketSession = "regular" | "premarket" | "after_hours" | "closed";

export type PaperOrderValidation = {
  ok: boolean;
  reason: string | null;
  estimatedNotional: number;
  estimatedMarginRequired: number;
};

export type PaperOrderImpact = {
  referencePrice: number;
  quantity: number;
  estimatedNotional: number;
  estimatedMarginRequired: number;
  estimatedMarginReleased: number;
  estimatedRealizedPnl: number;
  buyingPowerBefore: number;
  buyingPowerChange: number;
  buyingPowerAfter: number;
};

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const SIDE_VALUES = new Set<PaperOrderSide>([
  "buy",
  "sell",
  "sell_short",
  "buy_to_cover",
]);
const ORDER_TYPE_VALUES = new Set<PaperOrderType>([
  "market",
  "limit",
  "stop",
  "stop_limit",
]);
const TIF_VALUES = new Set<PaperTimeInForce>(["day", "gtc"]);
const SOURCE_VALUES = new Set<PaperOrderIntent["strategySource"]>([
  "manual",
  "spot_momentum",
  "before_crowd",
  "scanner",
  "ticker_detail",
]);

export const PAPER_TRADING_CONTRACT_VERSION = "ht-paper-trading-v2";
export const PAPER_CLOSE_ACTION = "close_position";

const finitePositive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const optionalPositive = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  return finitePositive(value);
};

export function normalizePaperOrderIntent(value: unknown): PaperOrderIntent | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const side = String(input.side ?? "") as PaperOrderSide;
  const orderType = String(input.orderType ?? "") as PaperOrderType;
  const timeInForce = String(input.timeInForce ?? "day") as PaperTimeInForce;
  const quantity = finitePositive(input.quantity);
  const strategySource = String(
    input.strategySource ?? "manual",
  ) as PaperOrderIntent["strategySource"];

  if (
    !SYMBOL_PATTERN.test(symbol) ||
    !SIDE_VALUES.has(side) ||
    !ORDER_TYPE_VALUES.has(orderType) ||
    !TIF_VALUES.has(timeInForce) ||
    !SOURCE_VALUES.has(strategySource) ||
    quantity === null
  ) {
    return null;
  }

  const limitPrice = optionalPositive(input.limitPrice);
  const stopPrice = optionalPositive(input.stopPrice);
  const takeProfitPrice = optionalPositive(input.takeProfitPrice);
  const stopLossPrice = optionalPositive(input.stopLossPrice);

  if (
    ((orderType === "limit" || orderType === "stop_limit") && limitPrice === null) ||
    ((orderType === "stop" || orderType === "stop_limit") && stopPrice === null) ||
    ((takeProfitPrice === null) !== (stopLossPrice === null))
  ) {
    return null;
  }

  return {
    symbol,
    side,
    orderType,
    timeInForce,
    quantity,
    limitPrice,
    stopPrice,
    allowExtendedHours: input.allowExtendedHours === true,
    takeProfitPrice,
    stopLossPrice,
    strategySource,
  };
}

export function paperOrderRequestSymbol(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const symbol = String(
    (value as Record<string, unknown>).symbol ?? "",
  ).trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function isPaperCloseRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return input.closePosition === true || input.action === PAPER_CLOSE_ACTION;
}

export function normalizePaperCloseIntent(
  value: unknown,
  position: PaperPosition | null,
): PaperOrderIntent | null {
  if (!isPaperCloseRequest(value) || !position || position.quantity === 0) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const symbol = paperOrderRequestSymbol(input);
  if (!symbol) return null;

  return normalizePaperOrderIntent({
    symbol,
    side: position.quantity > 0 ? "sell" : "buy_to_cover",
    orderType: input.orderType ?? "market",
    timeInForce: input.timeInForce ?? "day",
    quantity: Math.abs(position.quantity),
    limitPrice: input.limitPrice ?? null,
    stopPrice: input.stopPrice ?? null,
    allowExtendedHours: input.allowExtendedHours === true,
    takeProfitPrice: null,
    stopLossPrice: null,
    strategySource: input.strategySource ?? "manual",
  });
}

function easternParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: read("weekday"),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function easternCalendarParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: read("weekday"),
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

function nextWeekdayDate(date: string) {
  const cursor = new Date(`${date}T12:00:00.000Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      return cursor.toISOString().slice(0, 10);
    }
  }
  return date;
}

export function getPaperDayOrderTradingDate(
  submittedAt: Date,
  allowExtendedHours: boolean,
) {
  const submitted = easternCalendarParts(submittedAt);
  const cutoffMinutes = allowExtendedHours ? 20 * 60 : 16 * 60;
  if (
    submitted.weekday === "Sat" ||
    submitted.weekday === "Sun" ||
    submitted.minutes >= cutoffMinutes
  ) {
    return nextWeekdayDate(submitted.date);
  }
  return submitted.date;
}

export function isPaperDayOrderExpired(
  submittedAt: Date,
  now = new Date(),
  allowExtendedHours = false,
) {
  const current = easternCalendarParts(now);
  const tradingDate = getPaperDayOrderTradingDate(
    submittedAt,
    allowExtendedHours,
  );
  if (current.date > tradingDate) return true;
  if (current.date < tradingDate) return false;
  const cutoffMinutes = allowExtendedHours ? 20 * 60 : 16 * 60;
  return current.minutes >= cutoffMinutes;
}

export function getEasternMarketSession(now = new Date()): MarketSession {
  const { weekday, hour, minute } = easternParts(now);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  const minutes = hour * 60 + minute;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "regular";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "after_hours";
  return "closed";
}

export function isPaperOrderSessionEligible(
  session: MarketSession,
  allowExtendedHours: boolean,
): boolean {
  return session === "regular" || (
    allowExtendedHours && (session === "premarket" || session === "after_hours")
  );
}

export function simulatedBorrowTerms(quote: PaperQuote): {
  available: boolean;
  annualRatePercent: number | null;
  reason: string | null;
} {
  const referenceVolume = Math.max(quote.volume, quote.previousVolume);
  if (quote.price < 1) {
    return { available: false, annualRatePercent: null, reason: "Stocks below $1 are unavailable to short in the v1 simulation." };
  }
  if (referenceVolume < 250_000) {
    return { available: false, annualRatePercent: null, reason: "Simulated borrow is unavailable below the liquidity floor." };
  }
  const liquidityPremium = referenceVolume < 1_000_000 ? 12 : referenceVolume < 5_000_000 ? 5 : 0;
  const pricePremium = quote.price < 5 ? 8 : quote.price < 10 ? 3 : 0;
  return {
    available: true,
    annualRatePercent: 3 + liquidityPremium + pricePremium,
    reason: null,
  };
}

export function validatePaperOrder(
  intent: PaperOrderIntent,
  account: PaperAccount,
  position: PaperPosition | null,
  quote: PaperQuote,
): PaperOrderValidation {
  const quantity = intent.quantity;
  const positionQuantity = position?.quantity ?? 0;
  const impact = calculatePaperOrderImpact({
    side: intent.side,
    quantity,
    quotePrice: quote.price,
    account,
    position,
  });
  const { estimatedNotional, estimatedMarginRequired } = impact;

  if (intent.side === "sell_short" && !Number.isInteger(quantity)) {
    return { ok: false, reason: "Short orders require whole shares.", estimatedNotional, estimatedMarginRequired };
  }
  if (intent.side === "buy" && positionQuantity < 0) {
    return { ok: false, reason: "Use Buy to Cover for an open short position.", estimatedNotional, estimatedMarginRequired };
  }
  if (intent.side === "sell" && (positionQuantity <= 0 || quantity > positionQuantity)) {
    return { ok: false, reason: "Sell quantity exceeds the open long position.", estimatedNotional, estimatedMarginRequired };
  }
  if (intent.side === "sell_short" && positionQuantity > 0) {
    return { ok: false, reason: "Close the long position before selling short.", estimatedNotional, estimatedMarginRequired };
  }
  if (intent.side === "buy_to_cover" && (positionQuantity >= 0 || quantity > Math.abs(positionQuantity))) {
    return { ok: false, reason: "Cover quantity exceeds the open short position.", estimatedNotional, estimatedMarginRequired };
  }
  if (intent.side === "sell_short") {
    if (!account.marginEnabled) {
      return { ok: false, reason: "Margin simulation is disabled for this account.", estimatedNotional, estimatedMarginRequired };
    }
    const borrow = simulatedBorrowTerms(quote);
    if (!borrow.available) {
      return { ok: false, reason: borrow.reason, estimatedNotional, estimatedMarginRequired };
    }
    if (account.cashBalance - account.shortMarginHeld < estimatedMarginRequired) {
      return { ok: false, reason: "Insufficient simulated margin for this short.", estimatedNotional, estimatedMarginRequired };
    }
  }
  if (
    intent.side === "buy" &&
    account.cashBalance - account.shortMarginHeld < estimatedNotional
  ) {
    return { ok: false, reason: "Insufficient paper buying power.", estimatedNotional, estimatedMarginRequired };
  }
  if (intent.takeProfitPrice !== null && intent.stopLossPrice !== null) {
    const opensLong = intent.side === "buy";
    const opensShort = intent.side === "sell_short";
    if (!opensLong && !opensShort) {
      return { ok: false, reason: "Bracket exits are available only when opening a position.", estimatedNotional, estimatedMarginRequired };
    }
    if (
      opensLong &&
      !(intent.stopLossPrice < quote.price && intent.takeProfitPrice > quote.price)
    ) {
      return { ok: false, reason: "A long bracket needs a stop below and target above the quote.", estimatedNotional, estimatedMarginRequired };
    }
    if (
      opensShort &&
      !(intent.takeProfitPrice < quote.price && intent.stopLossPrice > quote.price)
    ) {
      return { ok: false, reason: "A short bracket needs a target below and stop above the quote.", estimatedNotional, estimatedMarginRequired };
    }
  }

  return { ok: true, reason: null, estimatedNotional, estimatedMarginRequired };
}

export function calculatePaperCloseQuantity(
  positionQuantity: number,
  fraction = 1,
): number {
  const available = Math.abs(positionQuantity);
  if (!Number.isFinite(available) || available <= 0) return 0;
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  if (fraction >= 1) return available;
  return Math.floor(available * fraction * 100_000_000) / 100_000_000;
}

export function calculatePaperOrderImpact({
  side,
  quantity,
  quotePrice,
  account,
  position,
}: {
  side: PaperOrderSide;
  quantity: number;
  quotePrice: number;
  account: Pick<PaperAccount, "cashBalance" | "shortMarginHeld">;
  position: PaperPosition | null;
}): PaperOrderImpact {
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const safePrice = Number.isFinite(quotePrice) && quotePrice > 0 ? quotePrice : 0;
  const estimatedNotional = safeQuantity * safePrice;
  const buyingPowerBefore = Math.max(
    0,
    account.cashBalance - account.shortMarginHeld,
  );
  const estimatedMarginRequired =
    side === "sell_short" ? estimatedNotional * 0.5 : 0;
  let estimatedMarginReleased = 0;
  let estimatedRealizedPnl = 0;
  let buyingPowerChange = 0;

  if (side === "buy") {
    buyingPowerChange = -estimatedNotional;
  } else if (side === "sell") {
    buyingPowerChange = estimatedNotional;
  } else if (side === "sell_short") {
    buyingPowerChange = -estimatedMarginRequired;
  } else if (position && position.quantity < 0) {
    const openQuantity = Math.abs(position.quantity);
    const coveredQuantity = Math.min(safeQuantity, openQuantity);
    estimatedMarginReleased = openQuantity > 0
      ? position.shortMarginHeld * (coveredQuantity / openQuantity)
      : 0;
    estimatedRealizedPnl =
      (position.averageEntryPrice - safePrice) * coveredQuantity;
    buyingPowerChange = estimatedMarginReleased + estimatedRealizedPnl;
  }

  return {
    referencePrice: safePrice,
    quantity: safeQuantity,
    estimatedNotional,
    estimatedMarginRequired,
    estimatedMarginReleased,
    estimatedRealizedPnl,
    buyingPowerBefore,
    buyingPowerChange,
    buyingPowerAfter: buyingPowerBefore + buyingPowerChange,
  };
}

export function shouldFillPaperOrder(
  order: Pick<PaperOrderIntent, "side" | "orderType" | "limitPrice" | "stopPrice">,
  quotePrice: number,
): boolean {
  const buyLike = order.side === "buy" || order.side === "buy_to_cover";
  if (order.orderType === "market") return true;
  if (order.orderType === "limit") {
    return buyLike
      ? quotePrice <= Number(order.limitPrice)
      : quotePrice >= Number(order.limitPrice);
  }
  if (order.orderType === "stop") {
    return buyLike
      ? quotePrice >= Number(order.stopPrice)
      : quotePrice <= Number(order.stopPrice);
  }
  const stopTriggered = buyLike
    ? quotePrice >= Number(order.stopPrice)
    : quotePrice <= Number(order.stopPrice);
  const limitSatisfied = buyLike
    ? quotePrice <= Number(order.limitPrice)
    : quotePrice >= Number(order.limitPrice);
  return stopTriggered && limitSatisfied;
}

export function calculatePaperFillPrice(
  side: PaperOrderSide,
  quotePrice: number,
  slippageBps: number,
): number {
  const buyLike = side === "buy" || side === "buy_to_cover";
  const multiplier = 1 + (buyLike ? 1 : -1) * (slippageBps / 10_000);
  return Math.max(0.00000001, Number((quotePrice * multiplier).toFixed(8)));
}

export function paperQuoteAgeMinutes(quote: PaperQuote, now = new Date()): number {
  const timestamp = Date.parse(quote.timestamp);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - timestamp) / 60_000);
}

export function estimatePaperSlippageBps(
  quote: PaperQuote,
  orderNotional: number,
): number {
  const dailyDollarVolume = Math.max(quote.volume, quote.previousVolume) * quote.price;
  if (dailyDollarVolume <= 0) return 25;
  const participation = orderNotional / dailyDollarVolume;
  return Math.min(50, Math.max(5, 5 + participation * 25_000));
}

export function markPaperPortfolio(
  account: PaperAccount,
  positions: Array<PaperPosition & { price: number }>,
): {
  longMarketValue: number;
  shortUnrealizedPnl: number;
  equity: number;
  buyingPower: number;
} {
  let longMarketValue = 0;
  let shortUnrealizedPnl = 0;
  for (const position of positions) {
    if (position.quantity > 0) {
      longMarketValue += position.quantity * position.price;
    } else if (position.quantity < 0) {
      shortUnrealizedPnl +=
        (position.averageEntryPrice - position.price) * Math.abs(position.quantity);
    }
  }
  const equity = account.cashBalance + longMarketValue + shortUnrealizedPnl;
  return {
    longMarketValue,
    shortUnrealizedPnl,
    equity,
    buyingPower: Math.max(0, account.cashBalance - account.shortMarginHeld),
  };
}
