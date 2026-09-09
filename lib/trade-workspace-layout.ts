export type TradeWorkspaceViewport = {
  width: number;
  height: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Keep the Phase 1 chart tied to the usable viewport without making the
 * shared chart canvas own page-layout concerns. Values are rounded to reduce
 * repeated chart reconstruction while mobile browser chrome is settling.
 */
export function resolveTradeWorkspaceChartHeight({
  width,
  height,
}: TradeWorkspaceViewport): number {
  const viewportWidth = Number.isFinite(width) && width > 0 ? width : 1024;
  const viewportHeight = Number.isFinite(height) && height > 0 ? height : 768;
  const compact = viewportWidth <= 767;
  const available = compact
    ? viewportHeight - 290
    : viewportHeight - 300;
  const rounded = Math.round(available / 8) * 8;

  return compact
    ? clamp(rounded, 280, 620)
    : clamp(rounded, 500, 720);
}
