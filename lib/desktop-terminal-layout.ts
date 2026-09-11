export const DESKTOP_TERMINAL_MIN_WIDTH = 1180;
export const DESKTOP_TERMINAL_MARKETS_AUTO_OPEN_WIDTH = 1360;
export const DESKTOP_TERMINAL_NAV_WIDTH = 56;
export const DESKTOP_TERMINAL_COLLAPSED_WIDTH = 30;
export const DESKTOP_TERMINAL_MIN_CHART_WIDTH = 640;

export type TerminalPanePreference = "auto" | "open" | "closed";

export type DesktopTerminalPreferences = {
  version: 1;
  markets: TerminalPanePreference;
  intelligence: TerminalPanePreference;
  marketsWidth: number;
  intelligenceWidth: number;
};

export type DesktopTerminalLayout = {
  terminal: boolean;
  marketsOpen: boolean;
  intelligenceOpen: boolean;
  marketsWidth: number;
  intelligenceWidth: number;
};

export const DESKTOP_TERMINAL_STORAGE_KEY = "ht-desktop-terminal-layout-v1";

export const DEFAULT_DESKTOP_TERMINAL_PREFERENCES: DesktopTerminalPreferences = {
  version: 1,
  markets: "auto",
  intelligence: "auto",
  marketsWidth: 220,
  intelligenceWidth: 296,
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const panePreference = (value: unknown): TerminalPanePreference =>
  value === "open" || value === "closed" ? value : "auto";

const finiteWidth = (value: unknown, fallback: number, minimum: number, maximum: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? clamp(Math.round(value), minimum, maximum)
    : fallback;

export function normalizeDesktopTerminalPreferences(
  value: unknown,
): DesktopTerminalPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_DESKTOP_TERMINAL_PREFERENCES;
  }
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return DEFAULT_DESKTOP_TERMINAL_PREFERENCES;
  return {
    version: 1,
    markets: panePreference(source.markets),
    intelligence: panePreference(source.intelligence),
    marketsWidth: finiteWidth(source.marketsWidth, 220, 210, 260),
    intelligenceWidth: finiteWidth(source.intelligenceWidth, 296, 280, 360),
  };
}

export function resolveDesktopTerminalLayout(
  viewportWidth: number,
  preferences: DesktopTerminalPreferences,
): DesktopTerminalLayout {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const terminal = width >= DESKTOP_TERMINAL_MIN_WIDTH;
  const marketsWidth = clamp(preferences.marketsWidth, 210, 260);
  const intelligenceWidth = clamp(preferences.intelligenceWidth, 280, 360);
  if (!terminal) {
    return {
      terminal: false,
      marketsOpen: false,
      intelligenceOpen: false,
      marketsWidth,
      intelligenceWidth,
    };
  }

  let marketsOpen = preferences.markets === "open" || (
    preferences.markets === "auto" && width >= DESKTOP_TERMINAL_MARKETS_AUTO_OPEN_WIDTH
  );
  let intelligenceOpen = preferences.intelligence !== "closed";
  const chartWidth = () => width - DESKTOP_TERMINAL_NAV_WIDTH -
    (marketsOpen ? marketsWidth : DESKTOP_TERMINAL_COLLAPSED_WIDTH) -
    (intelligenceOpen ? intelligenceWidth : DESKTOP_TERMINAL_COLLAPSED_WIDTH);

  if (chartWidth() < DESKTOP_TERMINAL_MIN_CHART_WIDTH) marketsOpen = false;
  if (chartWidth() < DESKTOP_TERMINAL_MIN_CHART_WIDTH) intelligenceOpen = false;

  return { terminal, marketsOpen, intelligenceOpen, marketsWidth, intelligenceWidth };
}

