"use client";

import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_LOCAL_STORAGE_KEYS,
} from "@/lib/account-deletion";
import { supabase } from "@/lib/supabaseClient";
import { StatusState } from "@/app/components/ui/ApplicationPrimitives";

type DeleteResponse = {
  ok?: boolean;
  error?: string;
};

export default function AccountSettings() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const passwordPending = useRef(false);

  useEffect(() => {
    let mounted = true;
    let receivedAuthEvent = false;
    const recoveryRequested = new URLSearchParams(window.location.search).get("recovery") === "1";
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (recoveryRequested) setRecovering(true);
      if (!receivedAuthEvent) setSession(data.session);
      setLoadingSession(false);
    }).catch(() => {
      if (!mounted) return;
      if (recoveryRequested) setRecovering(true);
      setLoadingSession(false);
      setMessage("Could not verify the account session. Reload and try again.");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      receivedAuthEvent = true;
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(nextSession);
      setLoadingSession(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handlePasswordRecovery = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordPending.current) return;
    if (!session) { setMessage("This reset link has expired. Request another reset email from HT Labs."); return; }
    if (newPassword.length < 8) { setMessage("Choose a password with at least 8 characters."); return; }
    if (newPassword !== repeatPassword) { setMessage("The passwords do not match."); return; }
    passwordPending.current = true;
    setSavingPassword(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) { setMessage("The password update could not be completed. Request a new reset link or try again."); return; }
      setNewPassword("");
      setRepeatPassword("");
      setPasswordSaved(true);
      // A recovery link may open outside the native app. Never imply that this
      // browser session signs the iPhone in; the user signs in there explicitly.
      try { await supabase.auth.signOut({ scope: "local" }); } catch { /* Password update already succeeded. */ }
    } catch {
      setMessage("Could not confirm the password update. Check your connection and try again.");
    } finally { passwordPending.current = false; setSavingPassword(false); }
  };

  const handleSignOut = async () => {
    setMessage("");
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  };

  const handleDelete = async () => {
    if (!session?.user.email) {
      setMessage("Sign in before deleting an account.");
      return;
    }
    if (!password) {
      setMessage("Enter your current password.");
      return;
    }
    if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
      setMessage(`Type ${ACCOUNT_DELETE_CONFIRMATION} exactly to confirm.`);
      return;
    }

    try {
      setDeleting(true);
      setMessage("Verifying your account...");

      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: session.user.email,
          password,
        });
      if (signInError || !data.session?.access_token) {
        setMessage("Password verification failed. Re-enter your current password and try again.");
        return;
      }

      setMessage("Permanently deleting your account...");
      const deleteResponse = await fetch("/api/account", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETE_CONFIRMATION }),
      });
      const result = (await deleteResponse.json()) as DeleteResponse;
      if (!deleteResponse.ok || !result.ok) {
        setMessage(deleteResponse.status === 401 || deleteResponse.status === 403
          ? "Your account session expired. Sign in again before retrying deletion."
          : "Account deletion is temporarily unavailable. Your account was not changed.");
        return;
      }

      for (const key of ACCOUNT_LOCAL_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      router.replace("/?accountDeleted=1");
      router.refresh();
    } catch {
      setMessage("Account deletion failed. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="ht-phase25-route ht-account-route min-h-screen bg-[#050505] px-5 pb-28 pt-8 text-white sm:px-8 sm:py-12" data-route-audience="account">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-10 flex flex-wrap items-center justify-between gap-4" aria-label="Account navigation">
          <Link href="/" className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <Image src="/logo.png" alt="HT Labs home" width={2909} height={1959} className="h-10 w-auto" priority />
          </Link>
          <div className="flex gap-2 text-xs font-black uppercase tracking-[0.12em] text-zinc-400">
            <Link href="/privacy" className="rounded-full border border-white/10 px-4 py-2 hover:text-white">Privacy</Link>
            <Link href="/terms" className="rounded-full border border-white/10 px-4 py-2 hover:text-white">Terms</Link>
          </div>
        </nav>

        <header className="mb-7">
          <p className="text-[11px] font-black uppercase tracking-[0.26em] text-orange-300">Account controls</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">Account &amp; Privacy</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-zinc-400">Manage authentication, review legal terms, or permanently remove your account and user-linked data.</p>
        </header>

        {loadingSession ? (
          <StatusState
            title="Checking your account"
            description="Verifying your secure HT Labs session…"
            busy
            className="p-8"
          />
        ) : recovering ? (
          <section className="ht-account-panel rounded-3xl border border-orange-400/25 bg-zinc-950 p-7">
            <h2 className="text-2xl font-black">{passwordSaved ? "Password updated" : "Choose a new password"}</h2>
            {passwordSaved ? <p className="mt-4 text-sm leading-6 text-zinc-300" role="status">Return to the HT Labs app and sign in with your new password. You can close this page.</p> : !session ? <p className="mt-4 text-sm leading-6 text-zinc-300" role="status">This reset link is expired or invalid. In HT Labs, open Paper → Forgot password and request a new email.</p> : <form className="mt-6 space-y-4" onSubmit={(event) => void handlePasswordRecovery(event)}>
              <label className="block"><span className="mb-2 block text-sm text-zinc-300">New password (at least 8 characters)</span><input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={savingPassword} className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-base text-white" /></label>
              <label className="block"><span className="mb-2 block text-sm text-zinc-300">Confirm new password</span><input type="password" autoComplete="new-password" minLength={8} required value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} disabled={savingPassword} className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-base text-white" /></label>
              <button type="submit" disabled={savingPassword || newPassword.length < 8 || !repeatPassword} className="min-h-11 w-full rounded-xl bg-orange-500 px-5 py-3 font-bold text-black disabled:opacity-40">{savingPassword ? "Updating password…" : "Save new password"}</button>
            </form>}
            {message && <p className="mt-4 text-sm text-orange-200" role="status">{message}</p>}
          </section>
        ) : !session ? (
          <section className="ht-account-panel rounded-3xl border border-white/10 bg-zinc-950 p-7" aria-labelledby="account-signed-out-heading">
            <h2 id="account-signed-out-heading" className="text-xl font-black">You are not signed in</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Open Profile in HT Labs to sign in or create an account. Privacy and Terms remain available without an account.</p>
            {message ? <p className="mt-3 text-sm text-amber-200" role="alert">{message}</p> : null}
            <Link href="/?tab=profile" className="mt-6 inline-flex rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-black">Open HT Labs Profile</Link>
          </section>
        ) : (
          <div className="space-y-6">
            <section className="ht-account-panel rounded-3xl border border-green-400/20 bg-green-500/[0.05] p-7">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-green-400">Signed in</p>
              <p className="mt-2 break-all text-lg font-black">{session.user.email}</p>
              <button type="button" onClick={handleSignOut} className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-black text-zinc-200">Sign out</button>
            </section>

            <section className="ht-account-panel ht-account-danger rounded-3xl border border-red-400/25 bg-red-500/[0.04] p-7">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300">Permanent deletion</p>
              <h2 className="mt-2 text-2xl font-black">Delete account</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-400">This permanently removes your Supabase login, cloud watchlist, user-linked signal memory, user-linked market behavior, and this device&apos;s saved HT Labs preferences. Global market observations and non-user-linked ProX research are not personal account records and are not affected.</p>

              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-zinc-400">Current password</span>
                  <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={deleting} className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white outline-none focus:border-red-400 disabled:opacity-50" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-zinc-400">Type DELETE to confirm</span>
                  <input type="text" autoCapitalize="characters" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleting} className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 font-mono text-white outline-none focus:border-red-400 disabled:opacity-50" />
                </label>
                <button type="button" onClick={handleDelete} disabled={deleting || confirmation !== ACCOUNT_DELETE_CONFIRMATION || !password} className="w-full rounded-xl bg-red-500 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {deleting ? "Deleting account..." : "Permanently delete my account"}
                </button>
                {message && <p className="text-sm font-semibold text-zinc-300" role="status" aria-live="polite">{message}</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
