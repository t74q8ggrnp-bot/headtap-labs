"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CryptoOpportunityFeed } from "@/lib/crypto/contracts";

export function useCryptoOpportunityFeed(
  initialFeed: CryptoOpportunityFeed | null = null,
) {
  const hasInitialFeed = initialFeed !== null;
  const needsImmediateRefresh =
    initialFeed === null || initialFeed.decisionFrame.fresh === false;
  const [feed, setFeed] = useState<CryptoOpportunityFeed | null>(initialFeed);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!hasInitialFeed);
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
    const kickoff = needsImmediateRefresh
      ? window.setTimeout(() => void refresh(), 0)
      : null;
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      if (kickoff !== null) window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [needsImmediateRefresh, refresh]);

  return { feed, error, loading, refresh };
}
