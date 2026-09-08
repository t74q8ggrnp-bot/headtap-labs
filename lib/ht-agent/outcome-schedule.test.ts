import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Agent outcome maintenance continues after close while CoinAPI collection is paused", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(config.crons.filter(job => job.path === "/api/ht-agent/outcomes"),
    [{ path:"/api/ht-agent/outcomes",schedule:"* * * * *" }]);
  assert.deepEqual(config.crons.filter(job => job.path === "/api/ht-agent/cycle").map(job => job.schedule),
    ["*/2 8-23 * * 1-5", "*/2 0 * * 2-6"]);
  assert.deepEqual(config.crons.filter(job => job.path === "/api/crypto/coinapi-collector").map(job => job.schedule),
    []);
});

test("expensive crypto evidence maintenance remains unscheduled during the owner pause", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.crons.filter((job: { path: string }) => job.path === "/api/crypto/evidence-maintenance"),
    []);
  assert.deepEqual(config.crons.filter((job: { path: string }) => job.path === "/api/crypto/prox-sensor"),
    [{ path: "/api/crypto/prox-sensor", schedule: "2-59/5 * * * *" }]);
});
