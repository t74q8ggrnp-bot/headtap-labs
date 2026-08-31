import { NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getMarketDataAgeMs } from "@/lib/market-data-time";
import { authenticatePaperRequest } from "@/lib/paper-trading/server";
import { getStockMarketClock } from "@/lib/stock-market-session";

export const dynamic = "force-dynamic";

type ObservationRow = {
  ticker: string;
  observed_at: string;
  role: string;
  rank: number;
  price: number | string;
  score: number | string;
  source_run_id: string | null;
  engine_version: string | null;
  prox_state: string | null;
  decision_snapshot: Record<string, unknown> | null;
};

type MicrostructureRow = {
  ticker: string;
  observed_at: string;
  market_as_of: string | null;
  bid_price: number | string | null;
  ask_price: number | string | null;
  spread_percent: number | string | null;
  recent_trade_count: number | null;
  source_data_mode: string;
};

type LedgerRow = {
  ticker: string;
  first_seen_at: string;
  first_seen_price: number | string;
  max_gain_percent: number | string | null;
  max_drawdown_percent: number | string | null;
};

const numberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function nearestAtOrBefore(
  observations: ObservationRow[],
  targetMs: number,
) {
  return observations.find(
    (observation) => new Date(observation.observed_at).getTime() <= targetMs,
  ) ?? null;
}

export async function GET(request: Request) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "authenticated-market-validation",
    limit: 30,
    windowMs: 60_000,
  });
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    ...rateLimit.headers,
  };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Validation cockpit rate limit reached." },
      { status: 429, headers },
    );
  }

  const context = await authenticatePaperRequest(request);
  if (!context) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401, headers },
    );
  }

  try {
    const collection = await context.service
      .from("ht_opportunity_collection_runs")
      .select("trading_date,observed_at,observation_minute,expected_observation_count,persisted_observation_count,complete")
      .eq("complete", true)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (collection.error) throw collection.error;
    if (!collection.data) {
      return NextResponse.json({
        ok: true,
        status: "awaiting_first_collection",
        marketClock: getStockMarketClock(),
        rows: [],
        generatedAt: new Date().toISOString(),
      }, { headers });
    }

    const frameAt = new Date(collection.data.observed_at);
    const historyStart = new Date(frameAt.getTime() - 12 * 60_000).toISOString();
    const observationsResult = await context.service
      .from("ht_opportunity_observations")
      .select("ticker,observed_at,role,rank,price,score,source_run_id,engine_version,prox_state,decision_snapshot")
      .eq("trading_date", collection.data.trading_date)
      .eq("strategy", "spot_momentum")
      .gte("observed_at", historyStart)
      .lte("observed_at", frameAt.toISOString())
      .order("observed_at", { ascending: false })
      .order("rank", { ascending: true })
      .limit(500);
    if (observationsResult.error) throw observationsResult.error;
    const observations = (observationsResult.data ?? []) as ObservationRow[];
    const historyByTicker = new Map<string, ObservationRow[]>();
    for (const observation of observations) {
      const history = historyByTicker.get(observation.ticker) ?? [];
      history.push(observation);
      historyByTicker.set(observation.ticker, history);
    }
    const latestObservationMs = observations.reduce(
      (latestMs, observation) => Math.max(
        latestMs,
        new Date(observation.observed_at).getTime(),
      ),
      0,
    );
    const latest = observations
      .filter((observation) =>
        new Date(observation.observed_at).getTime() === latestObservationMs
      )
      .sort((left, right) => left.rank - right.rank)
      .slice(0, 10);
    const tickers = latest.map((observation) => observation.ticker);

    const [microstructureResult, ledgerResult] = await Promise.all([
      tickers.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.service
            .from("prox_realtime_microstructure_observations")
            .select("ticker,observed_at,market_as_of,bid_price,ask_price,spread_percent,recent_trade_count,source_data_mode")
            .in("ticker", tickers)
            .order("observed_at", { ascending: false })
            .limit(200),
      tickers.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.service
            .from("ht_opportunity_ledger")
            .select("ticker,first_seen_at,first_seen_price,max_gain_percent,max_drawdown_percent")
            .eq("trading_date", collection.data.trading_date)
            .eq("strategy", "spot_momentum")
            .in("ticker", tickers),
    ]);
    if (microstructureResult.error) throw microstructureResult.error;
    if (ledgerResult.error) throw ledgerResult.error;

    const microstructureByTicker = new Map<string, MicrostructureRow>();
    for (const row of (microstructureResult.data ?? []) as MicrostructureRow[]) {
      if (!microstructureByTicker.has(row.ticker)) {
        microstructureByTicker.set(row.ticker, row);
      }
    }
    const ledgerByTicker = new Map(
      ((ledgerResult.data ?? []) as LedgerRow[]).map((row) => [row.ticker, row]),
    );

    const rows = latest.map((observation) => {
      const history = historyByTicker.get(observation.ticker) ?? [];
      const score = Number(observation.score);
      const oneMinute = nearestAtOrBefore(history, latestObservationMs - 60_000);
      const fiveMinute = nearestAtOrBefore(history, latestObservationMs - 5 * 60_000);
      const microstructure = microstructureByTicker.get(observation.ticker) ?? null;
      const ledger = ledgerByTicker.get(observation.ticker) ?? null;
      const price = Number(observation.price);
      const signalPrice = ledger ? Number(ledger.first_seen_price) : null;
      const snapshot = observation.decision_snapshot ?? {};
      const quoteAsOf = typeof snapshot.displayQuoteAsOf === "string"
        ? snapshot.displayQuoteAsOf
        : null;
      return {
        ticker: observation.ticker,
        role: observation.role,
        rank: observation.rank,
        score,
        scoreChange1m: oneMinute
          ? Number((score - Number(oneMinute.score)).toFixed(2))
          : null,
        scoreChange5m: fiveMinute
          ? Number((score - Number(fiveMinute.score)).toFixed(2))
          : null,
        price,
        relativeVolume: numberOrNull(snapshot.relativeVolume),
        marketSession: typeof snapshot.scanSession === "string"
          ? snapshot.scanSession
          : null,
        quoteAsOf,
        dataAgeMs: getMarketDataAgeMs(quoteAsOf),
        sourceRunId: observation.source_run_id,
        engineVersion: observation.engine_version,
        proxState: observation.prox_state,
        spreadPercent: numberOrNull(microstructure?.spread_percent),
        bid: numberOrNull(microstructure?.bid_price),
        ask: numberOrNull(microstructure?.ask_price),
        microstructureAsOf: microstructure?.market_as_of ?? null,
        recentTradeCount: microstructure?.recent_trade_count ?? null,
        microstructureDataMode: microstructure?.source_data_mode ?? null,
        signalAt: ledger?.first_seen_at ?? null,
        signalPrice,
        currentReturnPercent: signalPrice && signalPrice > 0
          ? Number((((price - signalPrice) / signalPrice) * 100).toFixed(3))
          : null,
        maxReturnPercent: numberOrNull(ledger?.max_gain_percent),
        maxDrawdownPercent: numberOrNull(ledger?.max_drawdown_percent),
        observedAt: observation.observed_at,
      };
    });

    return NextResponse.json({
      ok: true,
      status: "ready",
      authority: "server_observation_history_only",
      tradingDate: collection.data.trading_date,
      frameAt: new Date(latestObservationMs || frameAt.getTime()).toISOString(),
      coverage: {
        expected: collection.data.expected_observation_count,
        persisted: collection.data.persisted_observation_count,
        complete: collection.data.complete,
      },
      marketClock: getStockMarketClock(),
      rows,
      generatedAt: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    console.error("[market-validation] cockpit read failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { ok: false, error: "Validation cockpit is temporarily unavailable." },
      { status: 500, headers },
    );
  }
}
