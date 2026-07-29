"use client";

import { useCallback, useState } from "react";
import {
  mergeOpportunityLists,
  normalizeOpportunity,
  type Opportunity,
} from "@/lib/opportunity-model";

type OpportunityPayload = { opportunities?: unknown[] };

async function readOpportunities(response: Response) {
  if (!response.ok) throw new Error(`Opportunity request failed (${response.status})`);
  const payload = (await response.json()) as OpportunityPayload;
  return (payload.opportunities ?? []).map(normalizeOpportunity);
}

// Fetched alongside the hero so the runner-ups are already on hand — same
// canonical ranking, just not the #1 pick. Nobody should be locked into one
// ticker with no visibility into what else is close behind.
const MOMENTUM_CONTENDER_COUNT = 6;
const BEFORE_CROWD_COUNT = 5;

export function useOpportunityFeed() {
  const [spotMomentum, setSpotMomentum] = useState<Opportunity | null>(null);
  const [spotMomentumRunnersUp, setSpotMomentumRunnersUp] = useState<Opportunity[]>([]);
  const [catalyst, setCatalyst] = useState<Opportunity | null>(null);
  const [beforeCrowd, setBeforeCrowd] = useState<Opportunity[]>([]);
  // Full ranked list — same endpoint, same scoring engine, same live data
  // as everything else. Used by any surface that needs to show many
  // candidates (e.g. the in-page Scanner feed), not just the top picks.
  const [fullRankedList, setFullRankedList] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // "momentum", "catalyst", and the default ("all") request types all map
      // to the identical spot_momentum evaluation server-side (same for
      // before_crowd regardless of limit) — confirmed live: this used to be
      // 5 separate requests, 3 of them independently re-running the same
      // ~1.6-2s-each per-ticker evaluation from scratch just to return a
      // different slice/filter of data the other calls already computed.
      // One limit=100 call per strategy carries everything below needs.
      const [momentumRes, beforeCrowdRes] = await Promise.all([
        fetch("/api/opportunities?limit=100"),
        fetch("/api/opportunities?type=before_crowd&limit=100"),
      ]);

      const momentumList = await readOpportunities(momentumRes);
      setSpotMomentum(momentumList[0] ?? null);
      setSpotMomentumRunnersUp(momentumList.slice(1, MOMENTUM_CONTENDER_COUNT));
      // Same rule the server's own type=catalyst path applied (catalystScore
      // >= 20), against a list already ranked the same way — same result.
      setCatalyst(momentumList.find((o) => o.catalystScore >= 20) ?? null);
      setLoading(false);

      const beforeCrowdList = await readOpportunities(beforeCrowdRes);
      setBeforeCrowd(beforeCrowdList.slice(0, BEFORE_CROWD_COUNT));

      setFullRankedList(
        mergeOpportunityLists(momentumList, beforeCrowdList)
          .sort((a, b) => b.opportunityScore - a.opportunityScore),
      );
    } catch (error) {
      // Preserve the last verified response during transient refresh failures.
      console.warn("API opportunities fetch failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    spotMomentum,
    spotMomentumRunnersUp,
    catalyst,
    beforeCrowd,
    fullRankedList,
    loading,
    refresh,
  };
}
