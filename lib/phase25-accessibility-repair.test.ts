import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { resolveDialogFocusLoopTarget } from "./dialog-focus.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const luminance = (hex: string) => {
  const channels = hex.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (foreground: string, background: string) => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

const tokenHex = (css: string, name: string) => {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `missing ${name}`);
  return match[1];
};

test("Phase 2.5 semantic text and status tokens meet contrast on every shared dark surface", () => {
  const css = read("app/globals.css");
  const backgrounds = [
    "--ht-color-canvas",
    "--ht-color-surface",
    "--ht-color-surface-raised",
    "--ht-color-surface-inset",
    "--ht-color-surface-hover",
  ].map((name) => tokenHex(css, name));

  for (const name of ["--ht-color-text", "--ht-color-text-muted", "--ht-color-text-subtle"]) {
    const foreground = tokenHex(css, name);
    for (const background of backgrounds) {
      assert.ok(contrast(foreground, background) >= 4.5, `${name} must reach 4.5:1 on ${background}`);
    }
  }

  for (const name of ["--ht-color-accent", "--ht-color-accent-strong", "--ht-color-positive", "--ht-color-warning", "--ht-color-negative", "--ht-color-info"]) {
    const foreground = tokenHex(css, name);
    for (const background of backgrounds) {
      assert.ok(contrast(foreground, background) >= 3, `${name} must reach 3:1 on ${background}`);
    }
  }

  assert.match(css, /--ht-border-default:\s*rgba\(255, 255, 255, 0\.34\)/);
  assert.match(css, /--color-zinc-500:\s*var\(--ht-color-text-muted\)/);
  assert.match(css, /--color-zinc-600:\s*var\(--ht-color-text-subtle\)/);
  assert.match(css, /--color-zinc-700:\s*#85858e/);
});

test("Home loading results preserve ordered-list item semantics", () => {
  const scanner = read("app/components/desktop/ScannerGrid.tsx");
  assert.doesNotMatch(scanner, /<li[^>]*role="status"/);
  assert.match(scanner, /<li[^>]*>\s*<div role="status" aria-label="Loading scanner result">/);
});

test("dialog focus loop resolves forward and reverse boundaries", () => {
  assert.equal(resolveDialogFocusLoopTarget({ activeIndex: 2, focusableCount: 3, shiftKey: false }), "first");
  assert.equal(resolveDialogFocusLoopTarget({ activeIndex: 0, focusableCount: 3, shiftKey: true }), "last");
  assert.equal(resolveDialogFocusLoopTarget({ activeIndex: 1, focusableCount: 3, shiftKey: false }), null);
  assert.equal(resolveDialogFocusLoopTarget({ activeIndex: 1, focusableCount: 3, shiftKey: true }), null);
  assert.equal(resolveDialogFocusLoopTarget({ activeIndex: -1, focusableCount: 3, shiftKey: false }), "first");
  assert.equal(resolveDialogFocusLoopTarget({ activeIndex: -1, focusableCount: 3, shiftKey: true }), "last");
});

test("dialog keeps explicit focus trapping, Escape, restoration, modal background, and scroll locking", () => {
  const primitive = read("app/components/ui/ApplicationPrimitives.tsx");
  const css = read("app/globals.css");
  assert.match(primitive, /onKeyDown=\{\(event\) =>/);
  assert.match(primitive, /event\.key !== "Tab"/);
  assert.match(primitive, /event\.preventDefault\(\)/);
  assert.match(primitive, /onCancel=\{\(event\) =>/);
  assert.match(primitive, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(primitive, /dialog\.showModal\(\)/);
  assert.match(css, /html:has\(\.ht-dialog-sheet\[open\]\),\s*body:has\(\.ht-dialog-sheet\[open\]\)\s*\{\s*overflow: hidden;/);
});
