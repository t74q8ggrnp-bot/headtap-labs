export type ProxEpisodeDisposition = "selected" | "blocked" | "rejected";

export type ProxEpisodeRepresentative = {
  member_outcome_id: string;
  member_id: string;
  ticker: string;
  trading_date: string;
  market_session: "pre_market" | "regular" | "after_hours" | "closed";
  decision_at: string;
  entry_price: number;
  max_gain_percent: number;
  max_drawdown_percent: number;
  sampled_high_at: string;
  sampled_low_at: string;
  disposition: ProxEpisodeDisposition;
  role: "hero" | "contender" | "radar" | "none";
};

export type ProxEpisodeHorizon = {
  member_outcome_id: string;
  horizon: string;
  return_percent: number;
  resolution_state: "measured";
};

const HORIZON_ORDER = [
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "session_close",
  "next_session",
  "24h",
];

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return rounded(value);
}

function rate(hits: number, total: number): number | null {
  if (total === 0) return null;
  return rounded((hits / total) * 100);
}

function reachedGainBeforeDrawdown(
  episode: ProxEpisodeRepresentative,
  gainThreshold: number,
  drawdownThreshold = -5,
) {
  const gain = finite(episode.max_gain_percent) ?? 0;
  const drawdown = finite(episode.max_drawdown_percent) ?? 0;
  if (gain < gainThreshold) return false;
  if (drawdown > drawdownThreshold) return true;
  return (
    new Date(episode.sampled_high_at).getTime() <=
    new Date(episode.sampled_low_at).getTime()
  );
}

export function buildProxEpisodeScorecard(
  horizonRows: ProxEpisodeHorizon[],
  episodes: ProxEpisodeRepresentative[],
) {
  const episodeByOutcomeId = new Map(
    episodes.map((episode) => [episode.member_outcome_id, episode]),
  );
  const byDispositionHorizon = new Map<string, number[]>();
  const measuredEpisodeIds = new Set<string>();

  for (const horizonRow of horizonRows) {
    const episode = episodeByOutcomeId.get(horizonRow.member_outcome_id);
    const returnPercent = finite(horizonRow.return_percent);
    if (!episode || returnPercent === null) continue;
    const key = `${episode.disposition}:${horizonRow.horizon}`;
    const returns = byDispositionHorizon.get(key) ?? [];
    returns.push(returnPercent);
    byDispositionHorizon.set(key, returns);
    measuredEpisodeIds.add(episode.member_outcome_id);
  }

  const horizonResults = [...byDispositionHorizon.entries()]
    .map(([key, returns]) => {
      const [disposition, horizon] = key.split(":");
      return {
        disposition,
        horizon,
        sampleSize: returns.length,
        averageReturnPercent: average(returns),
        medianReturnPercent: median(returns),
        positiveReturnRatePercent: rate(
          returns.filter((value) => value > 0).length,
          returns.length,
        ),
      };
    })
    .sort((left, right) => {
      const dispositionOrder = left.disposition.localeCompare(right.disposition);
      if (dispositionOrder !== 0) return dispositionOrder;
      return HORIZON_ORDER.indexOf(left.horizon) - HORIZON_ORDER.indexOf(right.horizon);
    });

  const episodesByDisposition = new Map<
    ProxEpisodeDisposition,
    ProxEpisodeRepresentative[]
  >();
  for (const episode of episodes) {
    if (!measuredEpisodeIds.has(episode.member_outcome_id)) continue;
    const group = episodesByDisposition.get(episode.disposition) ?? [];
    group.push(episode);
    episodesByDisposition.set(episode.disposition, group);
  }

  const dispositionResults = [...episodesByDisposition.entries()]
    .map(([disposition, group]) => {
      const gains = group.map(
        (episode) => finite(episode.max_gain_percent) ?? 0,
      );
      const drawdowns = group.map(
        (episode) => finite(episode.max_drawdown_percent) ?? 0,
      );
      return {
        disposition,
        sampleSize: group.length,
        averageMaxGainPercent: average(gains),
        medianMaxGainPercent: median(gains),
        averageMaxDrawdownPercent: average(drawdowns),
        medianMaxDrawdownPercent: median(drawdowns),
        plusFiveBeforeMinusFiveHitRatePercent: rate(
          group.filter((episode) => reachedGainBeforeDrawdown(episode, 5)).length,
          group.length,
        ),
        plusTenBeforeMinusFiveHitRatePercent: rate(
          group.filter((episode) => reachedGainBeforeDrawdown(episode, 10)).length,
          group.length,
        ),
      };
    })
    .sort((left, right) => left.disposition.localeCompare(right.disposition));

  return {
    episodeDefinition: "first_ticker_date_session_disposition_decision",
    episodeCount: episodes.length,
    measuredEpisodeCount: measuredEpisodeIds.size,
    byDisposition: dispositionResults,
    byDispositionHorizon: horizonResults,
  };
}
