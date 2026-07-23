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
      const primaryRequest = fetch(`/api/opportunities?type=momentum&limit=${MOMENTUM_CONTENDER_COUNT}`);
      const secondaryRequest = Promise.all([
        fetch("/api/opportunities?type=catalyst&limit=3"),
        fetch("/api/opportunities?type=before_crowd&limit=5"),
      ]);
      const fullListRequest = Promise.all([
        fetch("/api/opportunities?limit=100"),
        fetch("/api/opportunities?type=before_crowd&limit=100"),
      ]);

      const primary = await readOpportunities(await primaryRequest);
      setSpotMomentum(primary[0] ?? null);
      setSpotMomentumRunnersUp(primary.slice(1));
      setLoading(false);

      const [catalystResponse, beforeCrowdResponse] = await secondaryRequest;
      const [catalysts, beforeCrowdOpportunities] = await Promise.all([
        readOpportunities(catalystResponse),
        readOpportunities(beforeCrowdResponse),
      ]);
      setCatalyst(catalysts[0] ?? null);
      setBeforeCrowd(beforeCrowdOpportunities);

      const [fullMomentumRes, fullBeforeCrowdRes] = await fullListRequest;
      const [fullMomentumData, fullBeforeCrowdData]: [OpportunityPayload, OpportunityPayload] = await Promise.all([
        fullMomentumRes.ok ? fullMomentumRes.json() : { opportunities: [] },
        fullBeforeCrowdRes.ok ? fullBeforeCrowdRes.json() : { opportunities: [] },
      ]);
      setFullRankedList(
        mergeOpportunityLists(
          fullMomentumData.opportunities ?? [],
          fullBeforeCrowdData.opportunities ?? [],
        ).sort((a, b) => b.opportunityScore - a.opportunityScore),
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
