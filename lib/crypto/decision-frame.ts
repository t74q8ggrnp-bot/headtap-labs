import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { CryptoOpportunityFeed } from "@/lib/crypto/contracts";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function isCryptoOpportunityFeed(value: unknown): value is CryptoOpportunityFeed {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const feed = value as Partial<CryptoOpportunityFeed>;
  return Boolean(
    feed.success === true &&
    feed.methodologyVersion === "crypto-momentum-v3-prox-authority" &&
    feed.decisionFrame?.version === "crypto-decision-frame-v1" &&
    Array.isArray(feed.contenders) &&
    Array.isArray(feed.radar),
  );
}

export function withCryptoFrameFreshness(
  feed: CryptoOpportunityFeed,
  now = new Date(),
  source: CryptoOpportunityFeed["decisionFrame"]["source"] = "materialized",
) {
  const freshUntilMs = new Date(feed.decisionFrame.freshUntil).getTime();
  const decisionAtMs = new Date(feed.decisionFrame.decisionAt).getTime();
  const fresh = Boolean(
    Number.isFinite(freshUntilMs) &&
    Number.isFinite(decisionAtMs) &&
    decisionAtMs <= now.getTime() + 30_000 &&
    freshUntilMs >= now.getTime(),
  );
  return {
    ...feed,
    decisionFrame: {
      ...feed.decisionFrame,
      fresh,
      source: fresh ? source : "stale_fallback",
    },
  } satisfies CryptoOpportunityFeed;
}

export async function loadLatestCryptoDecisionFeed({
  allowStale = false,
  now = new Date(),
}: {
  allowStale?: boolean;
  now?: Date;
} = {}) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("ht_crypto_decision_frames")
    .select("decision_at,fresh_until,complete,feed")
    .eq("complete", true)
    .order("decision_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || !isCryptoOpportunityFeed(data.feed)) return null;
  const feed = withCryptoFrameFreshness(data.feed, now);
  return feed.decisionFrame.fresh || allowStale ? feed : null;
}

export function makeCryptoFrameSafeForStaleDisplay(
  feed: CryptoOpportunityFeed,
  now = new Date(),
) {
  const freshness = withCryptoFrameFreshness(feed, now, "stale_fallback");
  const previous = [
    ...(freshness.hero ? [freshness.hero] : []),
    ...freshness.contenders,
    ...freshness.radar,
  ];
  const seen = new Set<string>();
  const radar = previous
    .filter((opportunity) => {
      if (seen.has(opportunity.productId)) return false;
      seen.add(opportunity.productId);
      return true;
    })
    .slice(0, 6)
    .map((opportunity) => ({
      ...opportunity,
      eligible: false,
      radarEligible: true,
      decisionState: "radar" as const,
      liveDataFresh: false,
      decisionReason: "The last complete backend frame has expired; this asset is observation-only until the next verified cycle.",
      authorityFlags: [
        ...new Set([...opportunity.authorityFlags, "decision_frame_stale"]),
      ],
    }));
  return {
    ...freshness,
    hero: null,
    contenders: [],
    radar,
    decisionFrame: {
      ...freshness.decisionFrame,
      fresh: false,
      source: "stale_fallback",
    },
  } satisfies CryptoOpportunityFeed;
}
