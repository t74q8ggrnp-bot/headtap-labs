import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 2.5 tokens cover each approved foundation category without replacing route classes", () => {
  const css = read("app/globals.css");
  for (const token of [
    "--ht-border-subtle",
    "--ht-divider",
    "--ht-color-surface",
    "--ht-space-4",
    "--ht-radius-panel",
    "--ht-type-body",
    "--ht-font-number",
    "--ht-focus-color",
    "--ht-selection-bg",
    "--ht-motion-standard",
  ]) assert.match(css, new RegExp(token));
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("shared primitives expose the requested shell, controls, rows, headers, states, and accessible sheet", () => {
  const source = read("app/components/ui/ApplicationPrimitives.tsx");
  for (const component of ["ApplicationShell", "Control", "PanelHeader", "DataRow", "StatusState", "AccessibleDialogSheet"]) {
    assert.match(source, new RegExp(`export function ${component}`));
  }
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /aria-describedby=\{description \? descriptionId : undefined\}/);
  assert.match(source, /onCancel=/);
  assert.match(source, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(source, /aria-busy=\{busy \|\| undefined\}/);
});

test("baseline manifests cover active routes and explicitly exclude shelved crypto", () => {
  const visual = JSON.parse(read("docs/phase-2-5/visual-baseline.json"));
  const requests = JSON.parse(read("docs/phase-2-5/request-baseline.json"));
  assert.equal(visual.captureCount, visual.routes.length * visual.viewports.length);
  assert.equal(visual.routes.length, 15);
  assert.equal(requests.routes.length, 15);
  assert.equal(visual.routes.some((route: { path: string }) => route.path.startsWith("/crypto")), false);
  assert.deepEqual(visual.excludedRoutes, ["/crypto", "/crypto/research", "/paper/crypto"]);
  assert.deepEqual(requests.excludedRoutes, visual.excludedRoutes);
  assert.equal(requests.routes.every((route: { horizontalOverflowPx: number }) => route.horizontalOverflowPx === 0), true);
});

test("request probe is development-only and counts API resources without fetching", () => {
  const layout = read("app/layout.tsx");
  const probe = read("app/components/dev/Phase25BaselineProbe.tsx");
  assert.match(layout, /process\.env\.NODE_ENV === "development"/);
  assert.match(probe, /performance\.getEntriesByType\("resource"\)/);
  assert.match(probe, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.doesNotMatch(probe, /fetch\(/);
});
