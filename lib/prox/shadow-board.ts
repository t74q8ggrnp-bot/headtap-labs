import type { ProxEdgeScoreResult } from "@/lib/prox/edge-score";

export const PROX_SHADOW_BOARD_VERSION = "prox-shadow-board-v1";

export type ProxShadowBoardCandidate = {
  ticker: string;
  price: number;
  discoveredAt: string;
  sourceObservationId: string;
  sourceObservedAt: string;
  marketSession: "pre_market" | "regular" | "after_hours" | "closed";
  discoveryPattern: string;
  dollarVolume: number;
  edge: ProxEdgeScoreResult;
};

export type ProxShadowBoardMember = ProxShadowBoardCandidate & {
  role: "hero" | "contender" | "radar" | "none";
  disposition: "selected" | "blocked" | "rejected";
  rank: number | null;
  dispositionReason: string;
};

export function buildProxShadowBoard(
  candidates: ProxShadowBoardCandidate[],
): ProxShadowBoardMember[] {
  const unique = new Map<string, ProxShadowBoardCandidate>();
  for (const candidate of candidates) {
    const ticker = candidate.ticker.toUpperCase().trim();
    const existing = unique.get(ticker);
    if (
      !existing ||
      candidate.edge.edgeScore > existing.edge.edgeScore ||
      (candidate.edge.edgeScore === existing.edge.edgeScore &&
        candidate.sourceObservedAt > existing.sourceObservedAt)
    ) {
      unique.set(ticker, { ...candidate, ticker });
    }
  }
  const ordered = [...unique.values()].sort(
    (left, right) =>
      Number(right.edge.entryQualified) - Number(left.edge.entryQualified) ||
      right.edge.edgeScore - left.edge.edgeScore ||
      right.edge.continuationProbability -
        left.edge.continuationProbability ||
      right.dollarVolume - left.dollarVolume ||
      left.ticker.localeCompare(right.ticker),
  );
  let selectedCount = 0;
  return ordered.map((candidate) => {
    if (candidate.edge.entryQualified && selectedCount < 6) {
      selectedCount += 1;
      return {
        ...candidate,
        role: selectedCount === 1 ? "hero" : "contender",
        disposition: "selected",
        rank: selectedCount,
        dispositionReason:
          selectedCount === 1
            ? "Highest independently qualified ProX Edge Score in this atomic frame."
            : "Independently qualified within the six-name shadow board.",
      };
    }
    if (!candidate.edge.entryQualified) {
      return {
        ...candidate,
        role: "radar",
        disposition: "blocked",
        rank: null,
        dispositionReason:
          candidate.edge.hardFailures[0] ??
          "Independent entry qualification was withheld.",
      };
    }
    return {
      ...candidate,
      role: "none",
      disposition: "rejected",
      rank: null,
      dispositionReason:
        "Entry-qualified but outside the six highest independent Edge Scores in this frame.",
    };
  });
}
