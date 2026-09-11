import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("consolidated desktop News navigation opens the News Intel interface", () => {
  const source = readFileSync(new URL("../lib/application-navigation.ts", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../app/components/ResponsiveApplicationShell.tsx", import.meta.url), "utf8");
  assert.match(source, /shortLabel: "News", href: "\/news-feed"/);
  assert.doesNotMatch(source, /href: "\/news"/);
  assert.match(shell, /APPLICATION_ROUTES\.map/);
});

test("bare legacy News URL redirects instead of returning JSON", () => {
  const source = readFileSync(new URL("../app/news/route.ts", import.meta.url), "utf8");

  assert.match(source, /if \(!symbol\) \{\s*return NextResponse\.redirect\(new URL\("\/news-feed", req\.url\)\);/);
  assert.doesNotMatch(source, /if \(!symbol\) \{\s*return NextResponse\.json\(\[\]\);/);
});
