import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const DESKTOP_NAV_FILES = [
  "app/HomeClient.tsx",
  "app/scanner/page.tsx",
  "app/signals/page.tsx",
];

test("desktop News navigation opens the News Intel interface", () => {
  for (const file of DESKTOP_NAV_FILES) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /href="\/news-feed"/);
    assert.doesNotMatch(source, /href="\/news"/);
  }
});

test("bare legacy News URL redirects instead of returning JSON", () => {
  const source = readFileSync(new URL("../app/news/route.ts", import.meta.url), "utf8");

  assert.match(source, /if \(!symbol\) \{\s*return NextResponse\.redirect\(new URL\("\/news-feed", req\.url\)\);/);
  assert.doesNotMatch(source, /if \(!symbol\) \{\s*return NextResponse\.json\(\[\]\);/);
});
