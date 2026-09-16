"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { AccessibleDialogSheet } from "@/app/components/ui/ApplicationPrimitives";
import {
  getCloudSyncStatus,
  getHomeAlertLane,
  getSafeAccountIdentity,
  type HomeAlert,
} from "@/lib/home-account";

type WatchlistSyncState = "loading" | "local" | "syncing" | "synced" | "error";

export function HomeAccountSurface({
  open,
  onOpenChange,
  authReady,
  session,
  email,
  password,
  authLoading,
  authMessage,
  cloudEnabled,
  syncState,
  syncError,
  watchlistCount,
  savedSetupCount,
  signalMemory,
  unreadAlertCount,
  onEmailChange,
  onPasswordChange,
  onAuthenticate,
  onSignOut,
  onOpenAlerts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authReady: boolean;
  session: Session | null;
  email: string;
  password: string;
  authLoading: boolean;
  authMessage: string;
  cloudEnabled: boolean;
  syncState: WatchlistSyncState;
  syncError: string | null;
  watchlistCount: number;
  savedSetupCount: number;
  signalMemory: { tracked: number; successRate: number | null } | null;
  unreadAlertCount: number;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onAuthenticate: (mode: "signin" | "signup") => void;
  onSignOut: () => void;
  onOpenAlerts: () => void;
}) {
  const identity = getSafeAccountIdentity(session?.user.email);
  const cloudStatus = getCloudSyncStatus({
    signedIn: Boolean(session),
    cloudEnabled,
    syncState,
    hasError: Boolean(syncError),
  });
  const submitSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAuthenticate("signin");
  };

  return (
    <AccessibleDialogSheet
      open={open}
      onOpenChange={onOpenChange}
      title={session ? "Your HT Labs account" : "Sign in to HT Labs"}
      description={session
        ? "Review synchronization, saved research, alerts, and privacy controls."
        : "Public market research stays available without an account. Sign in only when you want secure synchronization and private product features."}
      presentation="dialog"
      className="ht-home-account-dialog"
    >
      {!authReady ? (
        <div className="ht-home-account-state" role="status" aria-live="polite" aria-busy="true">
          <span className="htb-live-dot" aria-hidden="true" />
          <div><strong>Checking your session</strong><p>Confirming your secure HT Labs account state…</p></div>
        </div>
      ) : session ? (
        <div className="ht-home-profile">
          <section className="ht-home-profile__identity" aria-label="Signed-in identity">
            <span aria-hidden="true">{identity.initials}</span>
            <div><small>Signed in</small><strong>{session.user.email ?? identity.shortEmail}</strong></div>
          </section>

          <p className="ht-home-profile__sync" role="status" aria-live="polite">{cloudStatus}</p>

          <dl className="ht-home-profile__metrics">
            <div><dt>Watchlist</dt><dd>{watchlistCount}</dd></div>
            <div><dt>Saved setups</dt><dd>{savedSetupCount}</dd></div>
            <div><dt>Signal Memory</dt><dd>{signalMemory ? signalMemory.tracked : "Unavailable"}</dd></div>
            <div><dt>Success rate</dt><dd>{signalMemory && signalMemory.successRate !== null && signalMemory.tracked >= 20 ? `${signalMemory.successRate}%` : "Insufficient evidence"}</dd></div>
          </dl>

          <div className="ht-home-profile__actions">
            <button type="button" onClick={onOpenAlerts}>
              <span>HT Alerts</span><strong>{unreadAlertCount > 0 ? `${unreadAlertCount} unread` : "Up to date"}</strong>
            </button>
            <Link href="/account"><span>Account &amp; Privacy</span><strong>Security and deletion →</strong></Link>
          </div>

          <button type="button" className="ht-home-profile__signout" onClick={onSignOut} disabled={authLoading}>
            {authLoading ? "Signing out…" : "Sign out"}
          </button>
          {authMessage ? <p className="ht-home-auth-message" role="status" aria-live="polite">{authMessage}</p> : null}
        </div>
      ) : (
        <form className="ht-home-auth-form" onSubmit={submitSignIn} aria-busy={authLoading || undefined}>
          <p className="ht-home-auth-cloud">Your guest watchlist remains on this device. When you sign in, the existing reconciliation flow preserves it while synchronizing your cloud watchlist.</p>
          <label htmlFor="ht-home-auth-email">Email</label>
          <input
            id="ht-home-auth-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            data-autofocus
            value={email}
            disabled={authLoading}
            onChange={(event) => onEmailChange(event.target.value)}
          />
          <label htmlFor="ht-home-auth-password">Password</label>
          <input
            id="ht-home-auth-password"
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
            value={password}
            disabled={authLoading}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          <div className="ht-home-auth-actions">
            <button type="submit" disabled={authLoading}>{authLoading ? "Signing in…" : "Sign in"}</button>
            <button type="button" disabled={authLoading} onClick={() => onAuthenticate("signup")}>Create account</button>
          </div>
          {authMessage ? <p className="ht-home-auth-message" role="status" aria-live="polite">{authMessage}</p> : null}
          <p className="ht-home-auth-legal">By continuing, you agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.</p>
        </form>
      )}
    </AccessibleDialogSheet>
  );
}

export function HomeAlertsSurface({
  open,
  onOpenChange,
  alerts,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alerts: HomeAlert[];
  onSelect: (alert: HomeAlert) => void;
}) {
  const unreadCount = alerts.filter((alert) => !alert.read).length;

  return (
    <AccessibleDialogSheet
      open={open}
      onOpenChange={onOpenChange}
      title="HT Alerts"
      description={unreadCount > 0 ? `${unreadCount} unread Canonical opportunity alert${unreadCount === 1 ? "" : "s"}.` : "Canonical opportunity alerts generated during this browser session."}
      presentation="sheet"
      className="ht-home-alerts-dialog"
    >
      {alerts.length === 0 ? (
        <div className="ht-home-alerts-empty" role="status">
          <strong>No alerts yet</strong>
          <p>HT Labs is watching the existing Canonical opportunity feed. No additional market polling is used here.</p>
        </div>
      ) : (
        <ol className="ht-home-alert-list">
          {alerts.map((alert) => (
            <li key={alert.id} data-read={alert.read ? "true" : "false"}>
              <button type="button" onClick={() => onSelect(alert)}>
                <span className="ht-home-alert-list__meta">
                  <strong>{getHomeAlertLane(alert.type)}</strong>
                  <time dateTime={alert.timestamp.toISOString()}>{alert.timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                </span>
                <span className="ht-home-alert-list__ticker">{alert.ticker}</span>
                <span className="ht-home-alert-list__reason">{alert.message}</span>
                <span className="ht-home-alert-list__open">Open opportunity →</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </AccessibleDialogSheet>
  );
}
