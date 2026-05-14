"use client";

import { useEffect, useState } from "react";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/lib/supabaseClient";

export default function AuthPanel() {
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (!session) {
    return (
      <div className="rounded-3xl border border-orange-500/20 bg-black/40 p-6 backdrop-blur-xl">
        <p className="mb-4 text-xs font-black uppercase tracking-[0.3em] text-orange-400">
          HT LABS AUTH
        </p>

        <h2 className="mb-6 text-3xl font-black text-white">
          Sign In To HT Labs
        </h2>

        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: "#f97316",
                  brandAccent: "#ea580c",
                },
              },
            },
          }}
          providers={[]}
          theme="dark"
        />
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-green-500/20 bg-black/40 p-6 backdrop-blur-xl">
      <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
        CONNECTED
      </p>

      <h2 className="mt-2 text-2xl font-black text-white">
        Welcome Back
      </h2>

      <p className="mt-2 text-zinc-400">
        {session.user.email}
      </p>

      <button
        onClick={handleSignOut}
        className="mt-6 rounded-2xl bg-orange-500 px-5 py-3 font-black text-white transition hover:bg-orange-600"
      >
        Sign Out
      </button>
    </div>
  );
}