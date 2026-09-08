/** One display format for current prices, candle labels and chart axes. */
export function formatMarketPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const precision = value < 0.001 ? Math.min(12, Math.ceil(-Math.log10(value)) + 3) : value < 1 ? 6 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: precision,
  }).format(value);
}
