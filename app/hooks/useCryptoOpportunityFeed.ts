"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CryptoOpportunityFeed } from "@/lib/crypto/contracts";

export function useCryptoOpportunityFeed() {
  const [feed, setFeed] = useState<CryptoOpportunityFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const response = await fetch("/api/crypto/opportunities", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Crypto feed returned ${response.status}.`);
      }
      const payload = (await response.json()) as CryptoOpportunityFeed;
      setFeed(payload);
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Crypto feed unavailable.",
      );
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { feed, error, loading, refresh };
}
