/** Manual local diagnostic. No imports by app routes, cron, Agent or paper execution. */
import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createStreamMeasurement, streamSubscription, validateStreamTestPlan } from "../lib/crypto/coinapi-stream-measurement.ts";

const ENDPOINT = "wss://ws.coinapi.io/v1/";
const DEFAULT_PLAN = {
  marketIds: ["COINBASE_SPOT_BTC_USD", "COINBASE_SPOT_ETH_USD"],
  durationSeconds: 180, maxPayloadBytes: 8 * 1024 ** 2, quoteIntervalMs: 1000,
};

export function parseArguments(args) {
  const known = new Set(["--live", "--plan", "--provider-cap-confirmed", "--markets", "--seconds", "--output", "--approved-usd"]);
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!known.has(key) || values.has(key)) throw new Error("Unknown or repeated option.");
    if (["--live", "--plan", "--provider-cap-confirmed"].includes(key)) values.set(key, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("Missing option value.");
      values.set(key, value);
    }
  }
  if (values.has("--live") && values.has("--plan")) throw new Error("Choose plan or live, not both.");
  const plan = validateStreamTestPlan({ ...DEFAULT_PLAN,
    marketIds: values.has("--markets") ? String(values.get("--markets")).split(",") : DEFAULT_PLAN.marketIds,
    durationSeconds: values.has("--seconds") ? Number(values.get("--seconds")) : DEFAULT_PLAN.durationSeconds,
  });
  const live = values.has("--live");
  const approvedUsd = values.has("--approved-usd") ? Number(values.get("--approved-usd")) : null;
  const output = values.get("--output");
  if (live && (!Number.isFinite(approvedUsd) || approvedUsd <= 0 || approvedUsd > 1 ||
      !values.has("--provider-cap-confirmed") || typeof output !== "string" || !isAbsolute(output))) {
    throw new Error("Live test requires explicit owner budget (up to $1), confirmed provider-side cap, and a new absolute output path.");
  }
  return { live, plan, approvedUsd, output };
}

/** Injectable transport and clock let offline tests exercise the actual runner without a socket. */
export function runStreamTest({ plan, apiKey, socketFactory, now = Date.now,
  monotonicNow = () => performance.now(), signal, maxApprovedUsd, providerCapConfirmed }) {
  validateStreamTestPlan(plan);
  if (!apiKey?.trim() || !providerCapConfirmed || !Number.isFinite(maxApprovedUsd) || maxApprovedUsd <= 0 || maxApprovedUsd > 1) {
    throw new Error("Live test authorization and server-side credential are required.");
  }
  // Only the first connection is attempted. Errors never trigger paid retries.
  const start = now(), monotonicStart = monotonicNow();
  const meter = createStreamMeasurement(plan, start);
  return new Promise(resolve => {
    let finished = false, opened = false, lastMessageAt = monotonicStart, socket;
    const finish = reason => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      signal?.removeEventListener("abort", onAbort);
      try { socket?.close(1000, "Measurement finished"); } catch { /* no retry */ }
      const report = meter.report(now(), reason);
      report.operatorAttestedProviderSpendCapUsd = maxApprovedUsd;
      report.monotonicElapsedSeconds = (monotonicNow() - monotonicStart) / 1000;
      resolve(report);
    };
    const onAbort = () => finish("operator_stop");
    const timer = setInterval(() => {
      const elapsed = monotonicNow() - monotonicStart;
      if (Math.abs((now() - start) - elapsed) > 2000) finish("local_clock_changed");
      else if (elapsed >= plan.durationSeconds * 1000) finish("duration_limit");
      else if (!opened && elapsed >= 10_000) finish("connection_timeout");
      else if (opened && monotonicNow() - lastMessageAt >= 15_000) finish("heartbeat_timeout");
    }, 100);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { finish("operator_stop"); return; }
    try {
      socket = socketFactory(ENDPOINT);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        if (finished) { try { socket.close(); } catch { /* no retry */ } return; }
        opened = true; lastMessageAt = monotonicNow();
        try { socket.send(JSON.stringify({ ...streamSubscription(plan), apikey: apiKey })); }
        catch { finish("subscription_failed"); }
      });
      socket.addEventListener("message", event => {
        if (finished) return;
        lastMessageAt = monotonicNow();
        const raw = typeof event.data === "string" ? event.data
          : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : null;
        if (raw === null) { finish("unsupported_message_encoding"); return; }
        const reason = meter.record(raw, now());
        if (reason) finish(reason);
      });
      socket.addEventListener("error", () => finish("transport_error"));
      socket.addEventListener("close", () => finish("provider_disconnect"));
    } catch { finish("connection_failed"); }
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.live) {
    process.stdout.write(JSON.stringify({ mode: "offline_plan_no_provider_requests", plan: args.plan,
      subscription: streamSubscription(args.plan),
      configuredPayloadThresholdAtTier1RateUsd: args.plan.maxPayloadBytes / 1024 ** 3,
      estimateIsNotBillingCap: true, approvedSpending: false,
      stopConditions: ["time limit", "payload limit", "15s silence", "provider error", "unexpected feed", "operator interrupt"],
      actualProviderCostUsd: null, fullUniverseMonthlyCostUsd: null,
      boundaries: "No production writes, no REST requests, no reconnects, no orders, no public-feed changes.",
    }, null, 2) + "\n");
    return;
  }
  const apiKey = process.env.COINAPI_API_KEY;
  if (!apiKey?.trim() || typeof WebSocket !== "function") throw new Error("Credential or Node WebSocket runtime unavailable.");
  const lockPath = join(tmpdir(), "ht-coinapi-stream-benchmark.lock");
  // Exclusive same-host lock only; not a distributed production lease. Never remove an existing lock.
  const lock = openSync(lockPath, "wx", 0o600);
  let output;
  let cleanupDeferred = false;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const cleanup = () => {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    if (output !== undefined) closeSync(output);
    closeSync(lock); unlinkSync(lockPath);
  };
  try {
    output = openSync(args.output, "wx", 0o600); // Fail BEFORE spending if the report cannot be saved.
    writeSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), output: args.output }));
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    const report = await runStreamTest({ plan: args.plan, apiKey,
      socketFactory: url => new WebSocket(url), signal: controller.signal,
      maxApprovedUsd: args.approvedUsd, providerCapConfirmed: true });
    writeSync(output, JSON.stringify(report, null, 2) + "\n");
    const exitCode = report.stopReason === "duration_limit" ? 0 : 2;
    process.stdout.write(`Measurement saved to ${args.output}; stopped: ${report.stopReason}. Provider billing still needs reconciliation.\n`);
    // Hold the local lock through shutdown. A peer ignoring the close handshake
    // cannot keep this process spending or overlap the next ordinary local run.
    cleanupDeferred = true;
    setTimeout(() => { cleanup(); process.exit(exitCode); }, 1000);
  } finally {
    if (!cleanupDeferred) cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("Stream test did not start or finish. Check arguments, owner budget, provider cap, credential and report path. No retries were attempted.\n");
    process.exitCode = 1;
  });
}
