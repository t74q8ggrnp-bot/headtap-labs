"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeOpportunity, type Opportunity } from "@/lib/opportunity-model";

type OpportunityPayload = {
  opportunities?: unknown[];
  momentumRadar?: unknown[];
  momentumContenders?: unknown[];
};

async function readOpportunityPayload(response: Response) {
  if (!response.ok) throw new Error(`Opportunity request failed (${response.status})`);
  const payload = (await response.json()) as OpportunityPayload;
  return {
    opportunities: (payload.opportunities ?? []).map(normalizeOpportunity),
    momentumRadar: (payload.momentumRadar ?? []).map(normalizeOpportunity),
    momentumContenders: (payload.momentumContenders ?? []).map(
      normalizeOpportunity,
    ),
  };
}

// Fetched alongside the hero so the runner-ups are already on hand — same
// canonical ranking, just not the #1 pick. Nobody should be locked into one
// ticker with no visibility into what else is close behind.
const BEFORE_CROWD_COUNT = 5;

export function useOpportunityFeed() {
  const [spotMomentum, setSpotMomentum] = useState<Opportunity | null>(null);
  const [spotMomentumRunnersUp, setSpotMomentumRunnersUp] = useState<Opportunity[]>([]);
  const [beforeCrowd, setBeforeCrowd] = useState<Opportunity[]>([]);
  // Full ranked list — same endpoint, same scoring engine, same live data
  // as everything else. Used by any surface that needs to show many
  // candidates (e.g. the in-page Scanner feed), not just the top picks.
  const [fullRankedList, setFullRankedList] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      // "momentum", "catalyst", and the default ("all") request types all map
      // to the identical spot_momentum evaluation server-side (same for
      // before_crowd regardless of limit) — confirmed live: this used to be
      // 5 separate requests, 3 of them independently re-running the same
      // ~1.6-2s-each per-ticker evaluation from scratch just to return a
      // different slice/filter of data the other calls already computed.
      // One limit=100 call per strategy carries everything below needs.
      const momentumRequest = fetch("/api/opportunities?limit=100");
      const beforeCrowdRequest = fetch(
        "/api/opportunities?type=before_crowd&limit=100",
      );

      const momentumTask = momentumRequest.then(readOpportunityPayload).then(({ opportunities: momentumList, momentumContenders }) => {
        setSpotMomentum(momentumList[0] ?? null);
        setSpotMomentumRunnersUp(momentumContenders);
        setFullRankedList(momentumList);
        setLoading(false);
        return momentumList;
      });

      // Start both strategies together, but do not hold Spot Momentum hostage
      // to the slower Before-the-Crowd evaluation.
      const beforeCrowdTask = beforeCrowdRequest.then(readOpportunityPayload).then(({ opportunities: beforeCrowdList }) => {
        setBeforeCrowd(beforeCrowdList.slice(0, BEFORE_CROWD_COUNT));
        return beforeCrowdList;
      });

      const [momentumResult, beforeCrowdResult] = await Promise.allSettled([
        momentumTask,
        beforeCrowdTask,
      ]);
      if (momentumResult.status === "rejected") {
        console.warn("Momentum opportunities fetch failed:", momentumResult.reason);
      }
      if (beforeCrowdResult.status === "rejected") {
        console.warn("Before-the-Crowd opportunities fetch failed:", beforeCrowdResult.reason);
      }

    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Canonical decisions are page-critical data. Load them immediately when
  // the hook mounts rather than waiting for the separate quote-board request
  // to finish and mutate `stocks`. Refresh on the signal writer's cadence.
  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh();
    }, 60 * 1000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return {
    spotMomentum,
    spotMomentumRunnersUp,
    beforeCrowd,
    fullRankedList,
    loading,
    refresh,
  };
}
