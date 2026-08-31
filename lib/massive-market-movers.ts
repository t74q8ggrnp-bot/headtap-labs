import { massiveStocksUrl } from "@/lib/massive-stocks";
import type { PolygonSnapshotRow } from "@/lib/polygon-snapshot";

type MassiveMoverPayload = {
  tickers?: PolygonSnapshotRow[];
  error?: unknown;
  message?: unknown;
};

export type MassiveMoverSet = {
  gainers: PolygonSnapshotRow[];
  losers: PolygonSnapshotRow[];
  errors: string[];
};

async function fetchMoverLane(lane: "gainers" | "losers") {
  try {
    const response = await fetch(
      massiveStocksUrl(
        `/v2/snapshot/locale/us/markets/stocks/${lane}`,
        { include_otc: false },
      ),
      {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as MassiveMoverPayload;
    if (!response.ok) {
      const detail = payload.error ?? payload.message;
      throw new Error(
        typeof detail === "string" && detail.trim()
          ? detail
          : `Massive ${lane} returned ${response.status}.`,
      );
    }
    return { rows: payload.tickers ?? [], error: null };
  } catch (error) {
    return {
      rows: [] as PolygonSnapshotRow[],
      error: error instanceof Error ? error.message : `Massive ${lane} failed.`,
    };
  }
}

export async function fetchMassiveMarketMovers(): Promise<MassiveMoverSet> {
  const [gainers, losers] = await Promise.all([
    fetchMoverLane("gainers"),
    fetchMoverLane("losers"),
  ]);
  return {
    gainers: gainers.rows,
    losers: losers.rows,
    errors: [gainers.error, losers.error].filter(
      (error): error is string => Boolean(error),
    ),
  };
}
