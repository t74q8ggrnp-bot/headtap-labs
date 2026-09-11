import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_DESKTOP_TERMINAL_PREFERENCES,
  normalizeDesktopTerminalPreferences,
  resolveDesktopTerminalLayout,
// @ts-expect-error Node strip-types requires explicit TypeScript extensions.
} from "./desktop-terminal-layout.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop terminal applies the approved independent breakpoint compositions", () => {
  assert.equal(resolveDesktopTerminalLayout(1179, DEFAULT_DESKTOP_TERMINAL_PREFERENCES).terminal, false);
  assert.deepEqual(
    resolveDesktopTerminalLayout(1280, DEFAULT_DESKTOP_TERMINAL_PREFERENCES),
    {
      terminal: true,
      marketsOpen: false,
      intelligenceOpen: true,
      marketsWidth: 220,
      intelligenceWidth: 296,
    },
  );
  const standard = resolveDesktopTerminalLayout(1440, DEFAULT_DESKTOP_TERMINAL_PREFERENCES);
  assert.equal(standard.marketsOpen, true);
  assert.equal(standard.intelligenceOpen, true);
  const wide = resolveDesktopTerminalLayout(1720, DEFAULT_DESKTOP_TERMINAL_PREFERENCES);
  assert.equal(wide.marketsOpen, true);
  assert.equal(wide.intelligenceOpen, true);
});

test("pane preferences normalize, clamp, and remain independently controllable", () => {
  const normalized = normalizeDesktopTerminalPreferences({
    version: 1,
    markets: "closed",
    intelligence: "open",
    marketsWidth: 900,
    intelligenceWidth: 20,
  });
  assert.equal(normalized.markets, "closed");
  assert.equal(normalized.intelligence, "open");
  assert.equal(normalized.marketsWidth, 260);
  assert.equal(normalized.intelligenceWidth, 280);
  const layout = resolveDesktopTerminalLayout(1440, normalized);
  assert.equal(layout.marketsOpen, false);
  assert.equal(layout.intelligenceOpen, true);
});

test("terminal foundation keeps pane interactions local and chart content stable", () => {
  const frame = source("app/components/terminal/DesktopTerminalFrame.tsx");
  const hook = source("app/hooks/useDesktopTerminalLayout.ts");
  const css = source("app/globals.css");
  assert.doesNotMatch(frame, /fetch\(|XMLHttpRequest|useMarketChartFeed|useLiveMarketView/);
  assert.doesNotMatch(hook, /fetch\(|XMLHttpRequest/);
  assert.match(css, /grid-template-columns: 56px var\(--ht-terminal-markets-width\) minmax\(0, 1fr\) var\(--ht-terminal-intelligence-width\)/);
  assert.match(frame, /role="separator"/);
  assert.match(frame, /setPointerCapture/);
  assert.match(frame, /onLostPointerCapture=\{clear\}/);
  assert.match(frame, /inert=\{!layout\.marketsOpen\}/);
  assert.match(frame, /inert=\{!layout\.intelligenceOpen\}/);
  assert.doesNotMatch(frame, /key=\{/);
});

test("terminal typography is locally bundled and scoped", () => {
  const layout = source("app/layout.tsx");
  const css = source("app/globals.css");
  assert.match(layout, /localFont/);
  assert.match(layout, /\.\/fonts\/Manrope-Variable\.ttf/);
  assert.match(layout, /variable: "--font-ht-terminal"/);
  assert.match(css, /\.ht-terminal \{ display: none; \}/);
  assert.match(css, /font-family: var\(--font-ht-terminal\)/);
  assert.doesNotMatch(css.match(/body\s*\{[\s\S]*?\}/)?.[0] ?? "", /font-ht-terminal/);
});

test("terminal controls remain keyboard-visible and reduced-motion aware", () => {
  const navigation = source("app/components/terminal/DesktopTerminalNavigation.tsx");
  const css = source("app/globals.css");
  assert.match(navigation, /aria-label="Search ticker"/);
  assert.match(navigation, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(navigation, /window\.removeEventListener\("keydown", onKeyDown\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.ht-terminal-resizer:focus-visible::after/);
});
