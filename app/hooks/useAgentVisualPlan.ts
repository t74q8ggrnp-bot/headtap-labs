"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AgentXVisualPlanRead } from "@/lib/ht-agent/visual-plan-api";

export function useAgentVisualPlan(symbol: string, enabled: boolean) {
  const [read, setRead] = useState<AgentXVisualPlanRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++request.current;
    const auth = await supabase.auth.getSession();
    const token = auth.data.session?.access_token;
    if (!token || signal?.aborted) {
      if (generation === request.current) setRead(null);
      return;
    }
    const response = await fetch(`/api/ht-agent/plans?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json() as AgentXVisualPlanRead & { error?: string; ok?: boolean };
    if (!response.ok || body.ok !== true) throw new Error(body.error ?? "Agent X plan unavailable.");
    if (generation !== request.current || signal?.aborted) return;
    setRead(body);
    setError(null);
  }, [symbol]);

  useEffect(() => {
    request.current += 1;
    if (!enabled) return;
    const controller = new AbortController();
    const run = () => {
      if (document.visibilityState !== "visible") return;
      void refresh(controller.signal).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Agent X plan unavailable.");
      });
    };
    run();
    const timer = window.setInterval(run, 30_000);
    document.addEventListener("visibilitychange", run);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [enabled, refresh]);
  return {
    read: enabled && read?.symbol === symbol ? read : null,
    error: enabled ? error : null,
    refresh,
  };
}
