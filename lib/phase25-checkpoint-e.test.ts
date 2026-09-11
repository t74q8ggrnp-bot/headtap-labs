import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Checkpoint E preserves request endpoints and polling contracts", () => {
  const home = source("app/HomeClient.tsx");
  const scanner = source("app/scanner/page.tsx");
  const signals = source("app/signals/page.tsx");
  const news = source("app/news-feed/page.tsx");
  const prox = source("app/prox/page.tsx");

  for (const endpoint of [
    "/api/market-context",
    "/api/scanner_expansion?type=all",
    "/api/market-movers",
    "/api/ht-signals-feed",
  ]) assert.match(home, new RegExp(endpoint.replace(/[?]/g, "\\?")));
  assert.match(home, /setInterval\(\(\) => \{[\s\S]*?fetchCtx\(\);[\s\S]*?60 \* 1000\)/);

  assert.equal(scanner.match(/fetch\("\/api\/opportunities\?limit=100"\)/g)?.length, 1);
  assert.equal(scanner.match(/fetch\("\/api\/opportunities\?type=before_crowd&limit=100"\)/g)?.length, 1);
  assert.match(scanner, /setInterval\(fetchAll, 30000\)/);

  assert.equal(signals.match(/fetch\("\/api\/signals-history"\)/g)?.length, 1);
  assert.doesNotMatch(signals, /setInterval\(/);

  assert.equal(news.match(/fetch\(`\/api\/news-intel\?symbol=\$\{ticker\}`\)/g)?.length, 1);
  assert.match(news, /TOP_TICKERS\.slice\(0, 8\)/);
  assert.doesNotMatch(news, /setInterval\(/);

  assert.equal(prox.match(/fetch\("\/api\/prox-events\?limit=100"/g)?.length, 1);
  assert.match(prox, /setInterval\(load, 30000\)/);
});

test("discovery routes expose semantic summaries, collections, controls, and announced states", () => {
  const scanner = source("app/scanner/page.tsx");
  const signals = source("app/signals/page.tsx");
  const news = source("app/news-feed/page.tsx");
  const prox = source("app/prox/page.tsx");

  assert.match(scanner, /<dl className="ht-route-metrics/);
  assert.match(scanner, /<ol className="ht-market-card-list/);
  assert.match(scanner, /aria-pressed=\{filter === f\.value\}/);
  assert.match(scanner, /<StatusState busy/);

  assert.match(signals, /<table className="ht-intel-table">/);
  assert.match(signals, /<caption className="sr-only">/);
  assert.match(signals, /<th scope="col">/);
  assert.match(signals, /data-label="Ticker \/ engine"/);

  assert.match(news, /role="search"/);
  assert.match(news, /<ol className="ht-news-story-list">/);
  assert.match(news, /<button type="button" onClick=\{\(\) => setSelectedTicker/);
  assert.match(news, /<ul className="ht-article-list">/);

  assert.match(prox, /<ol className="ht-event-list"/);
  assert.match(prox, /<article className="ht-event-row">/);
  assert.match(prox, /discovery only/);
  assert.match(prox, /does not alter canonical HT scoring/);
});

test("mobile Home presents canonical intelligence in the approved priority order", () => {
  for (const path of [
    "app/components/opportunity/MobileSpotMomentumCard.tsx",
    "app/components/opportunity/MobileBeforeCrowdCard.tsx",
    "app/components/opportunity/MobileCardDetail.tsx",
  ]) {
    const component = source(path);
    const positions = [
      "1-ticker-price",
      "2-chart",
      "3-score-signal",
      "4-levels-risk",
      "5-extended-interpretation",
    ].map((marker) => component.indexOf(`data-home-priority="${marker}"`));
    assert.equal(positions.every((position) => position >= 0), true, `${path} includes every priority marker`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${path} keeps the approved DOM order`);
  }
});

test("Checkpoint E styling is opt-in and Pro X remains presentation-only", () => {
  const css = source("app/globals.css");
  const prox = source("app/prox/page.tsx");

  assert.match(css, /Phase 2\.5 Checkpoint E: discovery and intelligence surfaces/);
  assert.match(css, /\.ht-discovery-route/);
  assert.match(css, /\.ht-intel-table/);
  assert.match(css, /\.ht-mobile-home-card/);
  assert.doesNotMatch(prox, /edge-score|shadow-board|canonical-opportunity|broker|order|position/);
});
