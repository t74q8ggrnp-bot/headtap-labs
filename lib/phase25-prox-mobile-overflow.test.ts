import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("populated Pro X rows constrain their grid track and wrap mobile filing labels", () => {
  const css = read("app/globals.css");

  assert.match(css, /\.ht-event-list\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}/);
  assert.match(css, /\.ht-event-list\s*>\s*li\s*\{\s*min-width:\s*0;\s*\}/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.ht-event-row__link\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?text-overflow:\s*clip;[\s\S]*?white-space:\s*normal;/);
});

test("Pro X keeps its authoritative endpoint and polling contract", () => {
  const prox = read("app/prox/page.tsx");

  assert.equal(prox.match(/fetch\("\/api\/prox-events\?limit=100"/g)?.length, 1);
  assert.match(prox, /setInterval\(load, 30000\)/);
});
