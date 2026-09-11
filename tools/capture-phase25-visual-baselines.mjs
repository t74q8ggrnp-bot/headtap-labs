import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const baseUrl = process.env.HT_BASELINE_URL ?? "http://localhost:3000";
const outputRoot = path.resolve(root, process.env.HT_BASELINE_OUTPUT ?? ".artifacts/phase25-baseline");
const firefox = process.env.FIREFOX_BIN
  ?? (process.platform === "darwin" ? "/Applications/Firefox.app/Contents/MacOS/firefox" : "firefox");

const viewportCatalog = [
  { name: "mobile-375-short", width: 375, height: 667 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1720", width: 1720, height: 1000 },
];

const routeCatalog = [
  ["home", "/"],
  ["workspace", "/trade/SPY"],
  ["scanner", "/scanner"],
  ["signals", "/signals"],
  ["news", "/news-feed"],
  ["prox", "/prox"],
  ["paper", "/paper"],
  ["agent", "/agent"],
  ["qa", "/qa"],
  ["validation", "/validation"],
  ["trading-bot", "/trading-bot"],
  ["account", "/account"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["support", "/support"],
];

const selectedViewports = new Set((process.env.HT_BASELINE_VIEWPORTS ?? "").split(",").filter(Boolean));
const selectedRoutes = new Set((process.env.HT_BASELINE_ROUTES ?? "").split(",").filter(Boolean));
const viewports = selectedViewports.size > 0
  ? viewportCatalog.filter((viewport) => selectedViewports.has(viewport.name))
  : viewportCatalog;
const routes = selectedRoutes.size > 0
  ? routeCatalog.filter(([name]) => selectedRoutes.has(name))
  : routeCatalog;
const manifestOnly = process.env.HT_BASELINE_MANIFEST_ONLY === "1";

const run = (command, args, timeoutMs = 30_000) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit" });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    reject(new Error(`${command} exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code}`));
  });
});

await mkdir(outputRoot, { recursive: true });
const captures = [];

for (const viewport of viewports) {
  for (const [name, route] of routes) {
    const directory = path.join(outputRoot, viewport.name);
    const profile = path.join(outputRoot, ".profiles", `${viewport.name}-${name}`);
    const screenshot = path.join(directory, `${name}.png`);
    if (!manifestOnly) {
      await mkdir(directory, { recursive: true });
      await mkdir(profile, { recursive: true });
      await run(firefox, [
        "--headless",
        "--no-remote",
        "--profile", profile,
        "--window-size", `${viewport.width},${viewport.height}`,
        "--screenshot", screenshot,
        new URL(route, baseUrl).toString(),
      ]);
    }
    const bytes = await readFile(screenshot);
    captures.push({
      route,
      surface: name,
      viewport,
      file: path.relative(outputRoot, screenshot),
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}

await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, baseUrl, generatedAt: new Date().toISOString(), captures }, null, 2)}\n`,
);

console.log(`Captured ${captures.length} Phase 2.5 visual baselines in ${outputRoot}`);
