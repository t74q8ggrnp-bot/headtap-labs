import type { WorkspaceInstrument } from "./instrument-search";

export const WORKSPACE_INSTRUMENT_SEED_KEY = "htlabs-workspace-instrument-seed-v1";
export const WORKSPACE_INSTRUMENT_SEED_MAX_AGE_MS = 5 * 60 * 1_000;

type SeedStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredInstrumentSeed = {
  savedAt: number;
  instrument: WorkspaceInstrument;
};

function isUsableInstrument(value: unknown): value is WorkspaceInstrument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const instrument = value as Partial<WorkspaceInstrument>;
  return Boolean(
    typeof instrument.symbol === "string" &&
    typeof instrument.name === "string" &&
    instrument.active === true &&
    instrument.workspaceSupported === true &&
    instrument.provider === "massive_polygon" &&
    (instrument.assetKind === "stock" || instrument.assetKind === "etf"),
  );
}

export function writeWorkspaceInstrumentSeed(
  storage: SeedStorage,
  instrument: WorkspaceInstrument,
  now = Date.now(),
) {
  if (!isUsableInstrument(instrument)) return false;
  try {
    storage.setItem(
      WORKSPACE_INSTRUMENT_SEED_KEY,
      JSON.stringify({ savedAt: now, instrument } satisfies StoredInstrumentSeed),
    );
    return true;
  } catch {
    return false;
  }
}

export function readWorkspaceInstrumentSeed(
  storage: SeedStorage,
  symbol: string,
  now = Date.now(),
) {
  const clear = () => storage.removeItem(WORKSPACE_INSTRUMENT_SEED_KEY);
  try {
    const raw = storage.getItem(WORKSPACE_INSTRUMENT_SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredInstrumentSeed>;
    const savedAt = Number(parsed.savedAt);
    if (
      !Number.isFinite(savedAt) ||
      savedAt > now + 30_000 ||
      now - savedAt > WORKSPACE_INSTRUMENT_SEED_MAX_AGE_MS ||
      !isUsableInstrument(parsed.instrument) ||
      parsed.instrument.symbol !== symbol.trim().toUpperCase()
    ) {
      clear();
      return null;
    }
    clear();
    return parsed.instrument;
  } catch {
    clear();
    return null;
  }
}
