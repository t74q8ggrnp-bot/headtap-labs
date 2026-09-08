import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArguments, runStreamTest } from "./coinapi-stream-benchmark.mjs";

const plan = parseArguments([]).plan;
class FakeSocket extends EventTarget {
  sent = []; closes = 0;
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closes++; }
  emit(type, data) { const event = new Event(type); event.data = data; this.dispatchEvent(event); }
}
const options = (extras = {}) => ({ plan, apiKey: "private-test-key",
  providerCapConfirmed: true, maxApprovedUsd: 1, ...extras });

test("default CLI is offline even if an API key is present", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "tools/coinapi-stream-benchmark.mjs", "--plan"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, COINAPI_API_KEY: "private-test-key" },
  });
  const report = JSON.parse(output);
  assert.equal(report.mode, "offline_plan_no_provider_requests");
  assert.equal(report.approvedSpending, false); assert.equal(report.actualProviderCostUsd, null);
  assert.equal(output.includes("private-test-key"), false);
});

test("live invocation requires owner amount, provider control and new report path", () => {
  for (const args of [["--live"], ["--live", "--approved-usd", "1"], ["--live", "--approved-usd", "25", "--provider-cap-confirmed", "--output", "/tmp/sample.json"],
    ["--live", "--plan"], ["--seconds", "0"], ["--live", "--live"], ["--unknown"]]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(parseArguments(["--live", "--approved-usd", "1", "--provider-cap-confirmed", "--output", "/tmp/sample.json"]).approvedUsd, 1);
});

test("missing authorization prevents constructing any socket", () => {
  let connections = 0;
  const socketFactory = () => { connections++; return new FakeSocket(); };
  assert.throws(() => runStreamTest(options({ socketFactory, providerCapConfirmed: false })));
  assert.throws(() => runStreamTest(options({ socketFactory, maxApprovedUsd: 2 })));
  assert.throws(() => runStreamTest(options({ socketFactory, apiKey: "" })));
  assert.equal(connections, 0);
});

test("one connection, exact subscription, and no reconnect after an error", async () => {
  const socket = new FakeSocket(); let connections = 0;
  const result = runStreamTest(options({ socketFactory: url => { assert.equal(url, "wss://ws.coinapi.io/v1/"); connections++; return socket; } }));
  socket.emit("open");
  assert.deepEqual(socket.sent[0].subscribe_data_type, ["quote", "trade"]);
  assert.deepEqual(socket.sent[0].subscribe_filter_symbol_id, plan.marketIds.map(id => `${id}$`));
  assert.equal(socket.sent[0].apikey, "private-test-key");
  socket.emit("message", JSON.stringify({ type: "error", message: "private-test-key" }));
  const report = await result;
  socket.emit("error"); socket.emit("open");
  assert.equal(connections, 1); assert.equal(socket.sent.length, 1);
  assert.equal(report.stopReason, "provider_error"); assert.equal(JSON.stringify(report).includes("private-test-key"), false);
});

test("operator stop works before connection and during collection", async () => {
  const controller = new AbortController(); controller.abort();
  let connections = 0;
  const factory = () => { connections++; return new FakeSocket(); };
  const pre = await runStreamTest(options({ signal: controller.signal, socketFactory: factory }));
  assert.equal(pre.stopReason, "operator_stop"); assert.equal(connections, 0);
  const active = new AbortController();
  const result = runStreamTest(options({ signal: active.signal, socketFactory: factory }));
  active.abort();
  assert.equal((await result).stopReason, "operator_stop"); assert.equal(connections, 1);
});

test("connection timeout, heartbeat timeout, duration and wall-clock jumps all stop", async () => {
  for (const scenario of ["connection_timeout", "heartbeat_timeout", "duration_limit", "local_clock_changed"]) {
    let wall = 1_800_000_000_000, mono = 0;
    const socket = new FakeSocket();
    const result = runStreamTest(options({ now: () => wall, monotonicNow: () => mono, socketFactory: () => socket }));
    if (scenario !== "connection_timeout") socket.emit("open");
    const advance = scenario === "duration_limit" ? 180_000 : scenario === "connection_timeout" ? 10_000 : 15_000;
    wall += advance; if (scenario !== "local_clock_changed") mono += advance;
    assert.equal((await result).stopReason, scenario);
    assert.equal(socket.closes, 1);
  }
});

test("unrequested Tier 2 data immediately closes transport", async () => {
  const socket = new FakeSocket();
  const result = runStreamTest(options({ socketFactory: () => socket }));
  socket.emit("open"); socket.emit("message", JSON.stringify({ type: "ohlcv", data: "do not continue" }));
  const report = await result;
  assert.equal(report.stopReason, "unexpected_data_type"); assert.equal(socket.closes, 1);
  assert.equal(report.billing.totalMonthlyUsd, null);
});

test("benchmark contains no REST, database, cron, scoring or order dependencies", () => {
  const runner = readFileSync(new URL("coinapi-stream-benchmark.mjs", import.meta.url), "utf8");
  const core = readFileSync(new URL("../lib/crypto/coinapi-stream-measurement.ts", import.meta.url), "utf8");
  for (const code of [runner, core]) assert.doesNotMatch(code, /fetch\(|supabase|ht-agent|createOrder|paper-server|coinapi-pilot-server/);
  assert.match(runner, /openSync\(lockPath, "wx"/);
  assert.match(runner, /openSync\(args.output, "wx"/);
  const cron = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  assert.doesNotMatch(cron, /stream-benchmark|stream-measurement/);
});
