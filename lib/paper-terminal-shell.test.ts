import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Paper uses the shared terminal navigation without duplicating the legacy brand header", () => {
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");

  assert.match(paper, /<DesktopTerminalNavigation onResetLayout=\{resetLayout\} \/>/);
  assert.match(paper, /ht-paper-terminal-shell/);
  assert.match(paper, /ht-paper-terminal-content/);
  assert.doesNotMatch(paper, /<Link href="\/" aria-label="HT Labs home"><Image/);
  assert.equal(paper.match(/<HeroPriceChart/g)?.length, 1);
});

test("Paper terminal keeps the existing order and account authority inside the shared shell", () => {
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");

  assert.match(paper, /aria-label="Paper order ticket"/);
  assert.match(paper, /NO REAL MONEY/);
  assert.match(paper, /never routed to a live broker/);
  assert.match(paper, /dashboard\.account\.buyingPower/);
  assert.match(paper, /calculatePaperOrderImpact/);
  assert.match(paper, /fetch\(path/);
});

test("desktop Paper removes the outer website chrome and fills the terminal viewport", () => {
  const css = source("app/globals.css");

  assert.match(css, /data-application-route="paper"\]\s*>\s*\.ht-desktop-global-header[\s\S]*?display:\s*none/);
  assert.match(css, /\.ht-paper-terminal-shell\s*\{[\s\S]*?grid-template-columns:\s*56px minmax\(0, 1fr\)/);
  assert.match(css, /\.ht-paper-terminal-content\s*\{[\s\S]*?height:\s*100dvh/);
  assert.match(css, /\.ht-paper-route \.ht-paper-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 360px\)/);
});
