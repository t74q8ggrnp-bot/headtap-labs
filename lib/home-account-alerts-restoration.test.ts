import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { getCloudSyncStatus, getHomeAlertLane, getSafeAccountIdentity } from "./home-account.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("safe account identity never puts a full long local-part in compact controls", () => {
  assert.deepEqual(getSafeAccountIdentity("john.public@example.com"), {
    initials: "JP",
    shortEmail: "john.public@example.com",
  });
  assert.deepEqual(getSafeAccountIdentity("averylongaccountname@example.com"), {
    initials: "A",
    shortEmail: "averylong…@example.com",
  });
  assert.deepEqual(getSafeAccountIdentity(null), {
    initials: "HT",
    shortEmail: "HT Labs account",
  });
});

test("cloud synchronization copy is honest and keeps guest data explicit", () => {
  assert.match(getCloudSyncStatus({ signedIn: false, cloudEnabled: false, syncState: "local", hasError: false }), /Device watchlist active/);
  assert.match(getCloudSyncStatus({ signedIn: true, cloudEnabled: true, syncState: "syncing", hasError: false }), /Synchronizing/);
  assert.equal(getCloudSyncStatus({ signedIn: true, cloudEnabled: true, syncState: "synced", hasError: false }), "Cloud watchlist synchronized.");
  assert.match(getCloudSyncStatus({ signedIn: true, cloudEnabled: true, syncState: "error", hasError: true }), /device watchlist remains intact/i);
});

test("alerts retain their Canonical lane identity", () => {
  assert.equal(getHomeAlertLane("momentum"), "Spot Momentum");
  assert.equal(getHomeAlertLane("before_crowd"), "Before the Crowd");
  assert.equal(getHomeAlertLane("catalyst"), "Spot Momentum · Catalyst");
});

test("the recovered Home receives existing auth and alert state without market requests", () => {
  const client = source("app/HomeClient.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const account = source("app/components/home/HomeAccountAlerts.tsx");

  assert.match(client, /authReady=\{authReady\}/);
  assert.match(client, /session=\{session\}/);
  assert.match(client, /alerts=\{alerts\}/);
  assert.match(client, /onAuthenticate=\{\(mode\) => void handleAuth\(mode\)\}/);
  assert.match(surface, /<HomeAccountSurface/);
  assert.match(surface, /<HomeAlertsSurface/);
  assert.match(surface, /htlabs:open-account/);
  assert.match(surface, /htlabs:open-alerts/);
  assert.doesNotMatch(surface, /fetch\(|XMLHttpRequest|\/api\//);
  assert.doesNotMatch(account, /fetch\(|XMLHttpRequest|\/api\//);
});

test("authentication UI is labelled, announced, sanitized, and legally linked", () => {
  const account = source("app/components/home/HomeAccountAlerts.tsx");
  const client = source("app/HomeClient.tsx");

  assert.match(account, /htmlFor="ht-home-auth-email"/);
  assert.match(account, /autoComplete="email"/);
  assert.match(account, /htmlFor="ht-home-auth-password"/);
  assert.match(account, /autoComplete="current-password"/);
  assert.match(account, /role="status" aria-live="polite"/);
  assert.match(account, /href="\/privacy"/);
  assert.match(account, /href="\/terms"/);
  assert.match(account, /Guest watchlist remains on this device|guest watchlist remains on this device/i);
  assert.doesNotMatch(client, /setAuthMessage\(error\.message\)/);
  assert.doesNotMatch(client, /AUTH ERROR/);
  assert.doesNotMatch(account, /access_token|refresh_token|user\.id/);
});

test("account and paper entry points no longer depend on the bypassed profile tab", () => {
  const accountSettings = source("app/components/account/AccountSettings.tsx");
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");

  assert.doesNotMatch(accountSettings, /\?tab=profile/);
  assert.match(accountSettings, /href="\/\?auth=signin"/);
  assert.doesNotMatch(paper, /\?tab=profile/);
  assert.match(paper, /href="\/\?auth=signin"/);
});

test("mobile More exposes account and alerts while native iPhone supports orientation parity", () => {
  const mobile = source("app/components/MobileAppNavigation.tsx");
  const plist = source("ios/App/App/Info.plist");

  assert.match(mobile, /Sign in/);
  assert.match(mobile, /HT Alerts/);
  assert.match(mobile, /htlabs:open-account/);
  assert.match(mobile, /htlabs:open-alerts/);
  assert.doesNotMatch(mobile, /fetch\(|XMLHttpRequest|\/api\//);
  assert.match(plist, /UIInterfaceOrientationPortrait/);
  assert.match(plist, /UIInterfaceOrientationLandscapeLeft/);
  assert.match(plist, /UIInterfaceOrientationLandscapeRight/);
});
