// Extracted verbatim from page.tsx. These are the only functions in that
// file's local-scoring layer confirmed (via full call-graph analysis, not
// just a read-through) to have zero transitive dependency on component
// state — no closure over `news`/`newsIntel`, `watchlist`/`savedSetups`,
// `traderMode`, `stocks`, or `session`, and no call into any function that
// does. The rest of that layer (~76 functions) all eventually call back
// into one of five state-closing root functions and can't move without
// threading that state through as explicit parameters across the whole
// call graph — a much bigger, separate piece of work.
import type { MarketStock as Stock } from "@/lib/contracts/market";

export const getMomentumScore = (stock: Stock) => {
  const isBullish = stock.change >= 0;

  return Math.min(
    99,
    Math.max(
      52,
      Math.round(60 + Math.abs(stock.change) * 6 + (isBullish ? 8 : -2)),
    ),
  );
};

export const getRiskLabel = (stock: Stock) => {
  const move = Math.abs(stock.change);

  if (move >= 10) return "Extreme Volatility";
  if (move >= 5) return "High Attention Spike";
  if (move >= 2) return "Active";
  return "Normal";
};

export const getRelativeVolume = (stock: Stock) => {
  // Priority 1: Use pre-computed relativeVolume from ht_signals (Polygon data)
  if (stock.relativeVolume && stock.relativeVolume > 0) {
    return Number(Math.min(10, Math.max(0.1, stock.relativeVolume)).toFixed(1));
  }

  // Priority 2: Compute from raw volume if available
  if (stock.volume && stock.volume > 0 && stock.prevVolume && stock.prevVolume > 0) {
    const rvol = stock.volume / stock.prevVolume;
    return Number(Math.min(10, Math.max(0.1, rvol)).toFixed(1));
  }

  // Priority 3: Estimate from price change (last resort — no Polygon data available)
  const move = Math.abs(stock.change);
  return Number(Math.max(0.8, 1 + move / 3).toFixed(1));
};

export const getVolumeAcceleration = (stock: Stock) => {
  const rvol = getRelativeVolume(stock);

  if (rvol >= 5) return "Explosive";
  if (rvol >= 3) return "Accelerating";
  if (rvol >= 1.5) return "Active";

  return "Normal";
};

export const getConfidence = (stock: Stock) => {
  const base = getMomentumScore(stock);
  const momentumBonus = stock.change >= 0 ? 3 : -4;

  return Math.min(98, Math.max(45, base + momentumBonus));
};

export const getRiskProfile = (stock: Stock) => {
  const move = Math.abs(stock.change);

  if (move >= 15) return "VERY AGGRESSIVE";
  if (move >= 8) return "HIGH RISK";
  if (move >= 4) return "MODERATE";
  if (stock.change < 0) return "DEFENSIVE";

  return "CONTROLLED";
};

export const getInvalidationRule = (stock: Stock) => {
  if (stock.change >= 8) {
    return "Invalidates if the move loses volume, fails reclaim, or breaks the first higher-low structure.";
  }

  if (stock.change >= 2) {
    return "Invalidates if momentum fades below the active scanner threshold or volume dries up.";
  }

  if (stock.change < 0) {
    return "Invalidates bullish bias until price reclaims strength with confirmation.";
  }

  return "Invalidates if no attention, volume, or catalyst confirmation appears.";
};

export const getBestTraderFit = (stock: Stock) => {
  const move = Math.abs(stock.change);

  if (move >= 10) return "Best for aggressive momentum traders only.";
  if (move >= 4) return "Best for active momentum traders watching confirmation.";
  if (stock.change < 0) return "Best for patient traders waiting for reclaim confirmation.";

  return "Best for watchlist builders, not immediate chasing.";
};

export const getConfirmationTrigger = (stock: Stock) => {
  if (stock.change >= 8) return "Pullback hold, reclaim, or clean continuation after volume confirms.";
  if (stock.change >= 2) return "Higher-low structure with volume staying elevated.";
  if (stock.change < 0) return "Reclaim above weakness with improving signal quality.";

  return "Fresh volume, catalyst, or attention expansion.";
};

const CATALYST_SCORE_MIN = 40; // below this = keyword noise, not a verified event

// Labels written by signal-writer into ht_signals.state from real Polygon News.
// Not guessed from price/volume — must come from a recognized article keyword.
const HIGH_CONVICTION_EVENT_LABELS = new Set([
  // Biotech / drug development
  "FDA Event",
  "FDA Catalyst Active",
  "PDUFA Date",
  // Corporate actions
  "Earnings Catalyst",
  "M&A Activity",
  "Acquisition",
  "Merger Vote",
  // Regulatory / legal
  "Regulatory Event",
  "Court Ruling",
  // Commercial / product
  "Major Contract",
  "Product Launch",
  "Partnership",
  // Analyst / institutional
  "Analyst Upgrade",
]);

export type HCECategory =
  | "FDA / PDUFA"
  | "Earnings"
  | "Acquisition / Merger"
  | "Regulatory / Legal"
  | "Commercial Event"
  | "Analyst Event"
  | "Verified Catalyst";

// Returns the event category string if HCE, null if not.
export const getHCECategory = (stock: Stock): HCECategory | null => {
  const hasScore = (stock.catalystScore ?? 0) >= CATALYST_SCORE_MIN;
  if (!hasScore) return null;

  if (stock.hasFDAEvent) return "FDA / PDUFA";

  const label = stock.signalState ?? "";
  if (!HIGH_CONVICTION_EVENT_LABELS.has(label)) return null;

  if (label === "FDA Event" || label === "FDA Catalyst Active" || label === "PDUFA Date") return "FDA / PDUFA";
  if (label === "Earnings Catalyst") return "Earnings";
  if (label === "M&A Activity" || label === "Acquisition" || label === "Merger Vote") return "Acquisition / Merger";
  if (label === "Regulatory Event" || label === "Court Ruling") return "Regulatory / Legal";
  if (label === "Major Contract" || label === "Product Launch" || label === "Partnership") return "Commercial Event";
  if (label === "Analyst Upgrade") return "Analyst Event";
  return "Verified Catalyst";
};

export const isHighConvictionEvent = (stock: Stock): boolean => getHCECategory(stock) !== null;

export const getNextTriggerShort = (stock: Stock) => {
  if (stock.change >= 8) return "Pullback hold";
  if (stock.change >= 2) return "Higher-low hold";
  if (stock.change < 0) return "Reclaim first";
  return "Fresh volume";
};

export const getRiskGuardrailShort = (stock: Stock) => {
  if (Math.abs(stock.change) >= 10) return "Extension risk";
  if (stock.change < 0) return "Weak tape";
  if (getRelativeVolume(stock) >= 3) return "Volume must hold";
  return "Needs proof";
};
