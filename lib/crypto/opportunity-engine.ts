import type {
  CryptoOpportunity,
  CryptoPulseState,
} from "@/lib/crypto/contracts";

export type CryptoMarketSnapshot = {
  productId: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  last: number;
  volume24h: number;
  volume30d: number;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const rounded = (value: number, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

function liquidityScore(dollarVolume: number) {
  if (dollarVolume <= 0) return 0;
  return clamp((Math.log10(dollarVolume) - 4) * 25);
}

function pulseState(
  relativeVolume: number,
  pullbackFromHigh: number,
  rangePosition: number,
): CryptoPulseState {
  if (
    relativeVolume >= 1 &&
    pullbackFromHigh <= 7 &&
    rangePosition >= 70
  ) {
    return "expanding";
  }
  if (pullbackFromHigh <= 18 && rangePosition >= 45) return "stable";
  return "weakening";
}

export function scoreCryptoOpportunity(
  snapshot: CryptoMarketSnapshot,
): CryptoOpportunity | null {
  const { open, high, low, last, volume24h, volume30d } = snapshot;
  if (
    ![open, high, low, last, volume24h, volume30d].every(Number.isFinite) ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    last <= 0 ||
    volume24h < 0 ||
    volume30d <= 0
  ) {
    return null;
  }

  const change24h = ((last - open) / open) * 100;
  const pullbackFromHigh = Math.max(0, ((high - last) / high) * 100);
  const range = Math.max(0, high - low);
  const rangePosition =
    range > 0 ? clamp(((last - low) / range) * 100) : 50;
  const dollarVolume = volume24h * last;
  const averageDailyVolume30d = volume30d / 30;
  const relativeVolume =
    averageDailyVolume30d > 0 ? volume24h / averageDailyVolume30d : 0;
  const rangePercent = (range / open) * 100;

  const momentum = clamp(Math.max(0, change24h) * 4);
  const volume = clamp((relativeVolume - 0.25) * 70);
  const peakRetention = clamp(100 - pullbackFromHigh * 4);
  const liquidity = liquidityScore(dollarVolume);
  const liveRangePosition = clamp(rangePosition);
  const riskScore = clamp(
    rangePercent * 1.5 +
      pullbackFromHigh * 1.2 +
      (dollarVolume < 1_000_000 ? 20 : dollarVolume < 5_000_000 ? 10 : 0),
  );
  const rawScore =
    momentum * 0.32 +
    volume * 0.23 +
    peakRetention * 0.2 +
    liquidity * 0.15 +
    liveRangePosition * 0.1;
  const riskPenalty = Math.max(0, riskScore - 65) * 0.25;
  const opportunityScore = Math.round(clamp(rawScore - riskPenalty));
  const pulse = pulseState(
    relativeVolume,
    pullbackFromHigh,
    rangePosition,
  );
  const eligible = Boolean(
    dollarVolume >= 500_000 &&
      change24h >= 3 &&
      relativeVolume >= 0.6 &&
      pullbackFromHigh <= 35 &&
      opportunityScore >= 45,
  );
  const radarEligible = Boolean(
    !eligible &&
      dollarVolume >= 250_000 &&
      change24h >= 1 &&
      relativeVolume >= 0.4 &&
      pullbackFromHigh <= 45 &&
      opportunityScore >= 30,
  );
  const riskTags = [
    ...(dollarVolume < 1_000_000 ? ["Thin Liquidity"] : []),
    ...(rangePercent >= 25 ? ["High Volatility"] : []),
    ...(pullbackFromHigh >= 20 ? ["Peak Retention Risk"] : []),
    ...(change24h >= 30 ? ["Extended Move"] : []),
  ];
  const stage =
    pulse === "expanding"
      ? "Momentum Expanding"
      : pulse === "stable"
        ? "Momentum Holding"
        : "Momentum Cooling";

  return {
    productId: snapshot.productId,
    symbol: snapshot.symbol,
    price: rounded(last, last < 1 ? 6 : 4),
    change24hPercent: rounded(change24h),
    high24h: rounded(high, high < 1 ? 6 : 4),
    low24h: rounded(low, low < 1 ? 6 : 4),
    pullbackFromHighPercent: rounded(pullbackFromHigh),
    rangePositionPercent: rounded(rangePosition),
    volume24h: rounded(volume24h),
    dollarVolume24h: rounded(dollarVolume),
    relativeVolume: rounded(relativeVolume),
    opportunityScore,
    riskScore: Math.round(riskScore),
    pulseState: pulse,
    eligible,
    radarEligible,
    stage,
    summary: eligible
      ? `${snapshot.symbol} combines positive 24-hour momentum, above-threshold liquidity, volume participation, and acceptable peak retention.`
      : `${snapshot.symbol} has observable momentum, but one or more confirmation gates remain incomplete.`,
    riskTags,
    scoreBreakdown: {
      momentum: Math.round(momentum),
      volume: Math.round(volume),
      peakRetention: Math.round(peakRetention),
      liquidity: Math.round(liquidity),
      rangePosition: Math.round(liveRangePosition),
    },
  };
}
