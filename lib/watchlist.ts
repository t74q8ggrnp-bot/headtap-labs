import type { SupabaseClient } from "@supabase/supabase-js";

export const WATCHLIST_STORAGE_KEY = "headtap-watchlist";
export const WATCHLIST_CHANGED_EVENT = "htlabs:watchlist-changed";
export const WATCHLIST_BROADCAST_CHANNEL = "htlabs-watchlist-v1";
export const WATCHLIST_SYNC_STORAGE_PREFIX = "headtap-watchlist-sync-v1";
export const WATCHLIST_USER_STORAGE_PREFIX = "headtap-watchlist-user-v1";
export const WATCHLIST_GUEST_MIGRATION_STORAGE_KEY =
  "headtap-watchlist-guest-migration-v1";

export type WatchlistStorage = Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "key" | "length">>;

export type WatchlistMergePlan = {
  symbols: string[];
  cloudUpserts: string[];
};

export type WatchlistSyncSnapshot = {
  version: 1;
  userId: string;
  /** Last cloud membership this device successfully observed. */
  syncedSymbols: string[];
  /** Explicit device removals that have not yet been confirmed by cloud. */
  tombstones: string[];
};

export type WatchlistDeviceMessage = {
  version: 1;
  storageKey: string;
  symbols: string[];
};

export type InitializedWatchlist = {
  storageKey: string;
  symbols: string[];
  migratedGuest: boolean;
};

type WatchlistGuestMigrationClaim = {
  version: 1;
  claimedBy: string | null;
};

export type WatchlistReconciliationPlan = WatchlistMergePlan & {
  mode: "guest_migration" | "three_way";
  cloudDeletes: string[];
};

const SUPPORTED_SYMBOL = /^[A-Z0-9][A-Z0-9./^-]{0,31}$/;

/**
 * Normalize a provider symbol without trying to guess or repair it. Provider
 * validation happens at the instrument boundary; this helper only protects
 * persisted workspace state from empty, malformed, or unbounded values.
 */
export function normalizeWatchlistSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return SUPPORTED_SYMBOL.test(symbol) ? symbol : null;
}

export function normalizeWatchlistSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const item of value) {
    const symbol = normalizeWatchlistSymbol(item);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

export function parseStoredWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return normalizeWatchlistSymbols(JSON.parse(raw));
  } catch {
    return [];
  }
}

function normalizedWatchlistUserId(userId: string | null | undefined) {
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

/**
 * Guest state keeps the original key for backwards compatibility. Authenticated
 * device state is namespaced per account so changing accounts cannot reuse or
 * upload the previous account's local symbols.
 */
export function watchlistStorageKey(userId?: string | null): string {
  const normalizedUserId = normalizedWatchlistUserId(userId);
  return normalizedUserId
    ? `${WATCHLIST_USER_STORAGE_PREFIX}:${encodeURIComponent(normalizedUserId)}`
    : WATCHLIST_STORAGE_KEY;
}

export function readStoredWatchlist(
  storage: WatchlistStorage,
  userId?: string | null,
): string[] {
  try {
    return parseStoredWatchlist(storage.getItem(watchlistStorageKey(userId)));
  } catch {
    return [];
  }
}

export function writeStoredWatchlist(
  storage: WatchlistStorage,
  symbols: unknown,
  userId?: string | null,
): string[] {
  const normalized = normalizeWatchlistSymbols(symbols);
  const normalizedUserId = normalizedWatchlistUserId(userId);
  try {
    storage.setItem(
      watchlistStorageKey(normalizedUserId),
      JSON.stringify(normalized),
    );
    if (!normalizedUserId) {
      // A deliberate guest edit creates a new, claimable guest state. Writes
      // made while signed in never touch this key or reset this marker.
      storage.setItem(
        WATCHLIST_GUEST_MIGRATION_STORAGE_KEY,
        JSON.stringify({ version: 1, claimedBy: null }),
      );
    }
  } catch {
    // Browser privacy modes and exhausted storage must not break the UI. The
    // hook still retains the normalized in-memory value for this session.
  }
  return normalized;
}

function parseGuestMigrationClaim(
  raw: string | null,
): WatchlistGuestMigrationClaim | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WatchlistGuestMigrationClaim>;
    if (
      parsed.version !== 1 ||
      (parsed.claimedBy !== null && typeof parsed.claimedBy !== "string")
    ) {
      return null;
    }
    return {
      version: 1,
      claimedBy: normalizedWatchlistUserId(parsed.claimedBy),
    };
  } catch {
    return null;
  }
}

function legacyGuestStateIsClaimable(
  storage: WatchlistStorage,
  userId: string,
): boolean {
  if (typeof storage.key !== "function" || typeof storage.length !== "number") {
    return false;
  }
  try {
    const syncKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${WATCHLIST_SYNC_STORAGE_PREFIX}:`)) {
        syncKeys.push(key);
      }
    }
    // No snapshots means the legacy list was genuinely device-local. With one
    // snapshot, migrate only back into that same account. Anything else is
    // ambiguous and must fail closed instead of crossing account boundaries.
    return (
      syncKeys.length === 0 ||
      (syncKeys.length === 1 && syncKeys[0] === watchlistSyncStorageKey(userId))
    );
  } catch {
    return false;
  }
}

/**
 * Load the active device scope. A legacy/guest list may be copied into exactly
 * one authenticated account. The claim is persisted before the copy and read
 * back as a lightweight cross-tab guard. Once an account has its own key, guest
 * state is never consulted again—even when that account's list is empty.
 */
export function initializeStoredWatchlist(
  storage: WatchlistStorage,
  userId: string | null,
): InitializedWatchlist {
  const normalizedUserId = normalizedWatchlistUserId(userId);
  const storageKey = watchlistStorageKey(normalizedUserId);

  if (!normalizedUserId) {
    return {
      storageKey,
      symbols: readStoredWatchlist(storage),
      migratedGuest: false,
    };
  }

  try {
    const existing = storage.getItem(storageKey);
    if (existing !== null) {
      return {
        storageKey,
        symbols: parseStoredWatchlist(existing),
        migratedGuest: false,
      };
    }

    const guestSymbols = readStoredWatchlist(storage);
    const rawClaim = storage.getItem(WATCHLIST_GUEST_MIGRATION_STORAGE_KEY);
    const claim = parseGuestMigrationClaim(rawClaim);
    // A missing marker represents the one-time upgrade path from the legacy
    // global key. A malformed marker fails closed instead of leaking symbols.
    const claimable =
      guestSymbols.length > 0 &&
      ((rawClaim === null &&
        legacyGuestStateIsClaimable(storage, normalizedUserId)) ||
        claim?.claimedBy === null ||
        claim?.claimedBy === normalizedUserId);

    if (claimable) {
      const nextClaim: WatchlistGuestMigrationClaim = {
        version: 1,
        claimedBy: normalizedUserId,
      };
      storage.setItem(
        WATCHLIST_GUEST_MIGRATION_STORAGE_KEY,
        JSON.stringify(nextClaim),
      );
      const verifiedClaim = parseGuestMigrationClaim(
        storage.getItem(WATCHLIST_GUEST_MIGRATION_STORAGE_KEY),
      );
      if (verifiedClaim?.claimedBy === normalizedUserId) {
        const symbols = writeStoredWatchlist(
          storage,
          guestSymbols,
          normalizedUserId,
        );
        try {
          // Complete the migration as a move, not a copy. Signed-out guest mode
          // starts with an independent list instead of exposing the account's
          // migrated symbols. The claim marker remains owned by this account.
          storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([]));
        } catch {
          // The account-scoped copy already succeeded; storage restrictions
          // should not make the initialized in-memory watchlist disappear.
        }
        return { storageKey, symbols, migratedGuest: true };
      }
    }

    // Persist an empty account scope. This is meaningful: a later guest edit
    // must not unexpectedly migrate into an account already used on this device.
    const symbols = writeStoredWatchlist(storage, [], normalizedUserId);
    return { storageKey, symbols, migratedGuest: false };
  } catch {
    return { storageKey, symbols: [], migratedGuest: false };
  }
}

export function createWatchlistDeviceMessage(
  userId: string | null,
  symbols: unknown,
): WatchlistDeviceMessage {
  return {
    version: 1,
    storageKey: watchlistStorageKey(userId),
    symbols: normalizeWatchlistSymbols(symbols),
  };
}

export function parseWatchlistDeviceMessage(
  value: unknown,
): WatchlistDeviceMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WatchlistDeviceMessage>;
  if (
    candidate.version !== 1 ||
    typeof candidate.storageKey !== "string" ||
    !candidate.storageKey
  ) {
    return null;
  }
  return {
    version: 1,
    storageKey: candidate.storageKey,
    symbols: normalizeWatchlistSymbols(candidate.symbols),
  };
}

export function watchlistSyncStorageKey(userId: string): string {
  return `${WATCHLIST_SYNC_STORAGE_PREFIX}:${userId}`;
}

export function parseWatchlistSyncSnapshot(
  raw: string | null,
  userId: string,
): WatchlistSyncSnapshot | null {
  if (!raw || !userId) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WatchlistSyncSnapshot>;
    if (parsed.version !== 1 || parsed.userId !== userId) return null;
    return {
      version: 1,
      userId,
      syncedSymbols: normalizeWatchlistSymbols(parsed.syncedSymbols),
      tombstones: normalizeWatchlistSymbols(parsed.tombstones),
    };
  } catch {
    return null;
  }
}

export function readWatchlistSyncSnapshot(
  storage: WatchlistStorage,
  userId: string,
): WatchlistSyncSnapshot | null {
  try {
    return parseWatchlistSyncSnapshot(
      storage.getItem(watchlistSyncStorageKey(userId)),
      userId,
    );
  } catch {
    return null;
  }
}

export function writeWatchlistSyncSnapshot(
  storage: WatchlistStorage,
  snapshot: WatchlistSyncSnapshot,
): WatchlistSyncSnapshot {
  const normalized: WatchlistSyncSnapshot = {
    version: 1,
    userId: snapshot.userId,
    syncedSymbols: normalizeWatchlistSymbols(snapshot.syncedSymbols),
    tombstones: normalizeWatchlistSymbols(snapshot.tombstones),
  };
  try {
    storage.setItem(
      watchlistSyncStorageKey(snapshot.userId),
      JSON.stringify(normalized),
    );
  } catch {
    // Sync continues in memory when device storage is unavailable.
  }
  return normalized;
}

export function setWatchlistSnapshotMembership(
  snapshot: WatchlistSyncSnapshot,
  value: unknown,
  watched: boolean,
): WatchlistSyncSnapshot {
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) return snapshot;
  return {
    ...snapshot,
    syncedSymbols: setWatchlistMembership(
      snapshot.syncedSymbols,
      symbol,
      watched,
    ),
    // A successful cloud mutation settles any local deletion marker.
    tombstones: snapshot.tombstones.filter((item) => item !== symbol),
  };
}

export function setWatchlistSnapshotTombstone(
  snapshot: WatchlistSyncSnapshot,
  value: unknown,
  deleted: boolean,
): WatchlistSyncSnapshot {
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) return snapshot;
  return {
    ...snapshot,
    tombstones: setWatchlistMembership(
      snapshot.tombstones,
      symbol,
      deleted,
    ),
  };
}

/**
 * Merge guest/device state into cloud state without deleting either side.
 * This path is used only when a device has never synchronized this account.
 */
export function buildWatchlistMergePlan(
  localSymbols: unknown,
  cloudSymbols: unknown,
): WatchlistMergePlan {
  const local = normalizeWatchlistSymbols(localSymbols);
  const cloud = normalizeWatchlistSymbols(cloudSymbols).sort((left, right) =>
    left.localeCompare(right),
  );
  const localSet = new Set(local);
  const cloudSet = new Set(cloud);

  return {
    symbols: [
      ...local,
      ...cloud.filter((symbol) => !localSet.has(symbol)),
    ],
    cloudUpserts: local.filter((symbol) => !cloudSet.has(symbol)),
  };
}

/**
 * Reconcile a device and cloud with a three-way snapshot. A first-time device
 * gets the additive guest migration above. Once synchronized, a deletion on
 * either side wins for symbols that existed in the shared base. That prevents
 * an older open tab from resurrecting a ticker removed on another device.
 */
export function buildWatchlistReconciliationPlan(
  localSymbols: unknown,
  cloudSymbols: unknown,
  snapshot: WatchlistSyncSnapshot | null,
): WatchlistReconciliationPlan {
  const local = normalizeWatchlistSymbols(localSymbols);
  const cloud = normalizeWatchlistSymbols(cloudSymbols).sort((left, right) =>
    left.localeCompare(right),
  );

  if (!snapshot) {
    const guestPlan = buildWatchlistMergePlan(local, cloud);
    return {
      ...guestPlan,
      mode: "guest_migration",
      cloudDeletes: [],
    };
  }

  const base = new Set(normalizeWatchlistSymbols(snapshot.syncedSymbols));
  const localSet = new Set(local);
  const cloudSet = new Set(cloud);
  const deletions = new Set(normalizeWatchlistSymbols(snapshot.tombstones));

  for (const symbol of base) {
    if (!localSet.has(symbol) || !cloudSet.has(symbol)) deletions.add(symbol);
  }

  const symbols = normalizeWatchlistSymbols([...local, ...cloud]).filter(
    (symbol) => !deletions.has(symbol),
  );
  const symbolSet = new Set(symbols);

  return {
    mode: "three_way",
    symbols,
    cloudUpserts: symbols.filter((symbol) => !cloudSet.has(symbol)),
    cloudDeletes: cloud.filter((symbol) => !symbolSet.has(symbol)),
  };
}

export function setWatchlistMembership(
  currentSymbols: unknown,
  value: unknown,
  watched: boolean,
): string[] {
  const current = normalizeWatchlistSymbols(currentSymbols);
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) return current;

  if (watched) {
    return current.includes(symbol) ? current : [...current, symbol];
  }
  return current.filter((item) => item !== symbol);
}

function cloudError(action: string, error: { message?: string } | null): Error {
  return new Error(error?.message || `Unable to ${action} cloud watchlist.`);
}

function isUniqueViolation(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "23505" ||
    /duplicate key|unique constraint/i.test(error?.message ?? "")
  );
}

export async function readCloudWatchlist(
  client: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("ht_labs_watchlist")
    .select("symbol")
    .eq("user_id", userId);

  if (error) throw cloudError("read", error);
  return normalizeWatchlistSymbols(
    (data ?? []).map((row: { symbol?: unknown }) => row.symbol),
  ).sort((left, right) => left.localeCompare(right));
}

/**
 * An idempotent single-symbol insert that does not assume a composite unique
 * constraint exists in production. It checks exact owner + symbol membership
 * first. A concurrent insert can still race when a constraint exists, so a
 * Postgres unique violation is also treated as success.
 */
export async function upsertCloudWatchlistSymbol(
  client: SupabaseClient,
  userId: string,
  value: unknown,
): Promise<string> {
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) throw new Error("A valid symbol is required.");

  const { data: existing, error: readError } = await client
    .from("ht_labs_watchlist")
    .select("symbol")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .limit(1);
  if (readError) throw cloudError("read", readError);
  if ((existing ?? []).length > 0) return symbol;

  const { error } = await client
    .from("ht_labs_watchlist")
    .insert({ user_id: userId, symbol });
  if (error && !isUniqueViolation(error)) throw cloudError("update", error);
  return symbol;
}

/** A single-symbol delete scoped to the authenticated owner. */
export async function deleteCloudWatchlistSymbol(
  client: SupabaseClient,
  userId: string,
  value: unknown,
): Promise<string> {
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) throw new Error("A valid symbol is required.");

  const { error } = await client
    .from("ht_labs_watchlist")
    .delete()
    .eq("user_id", userId)
    .eq("symbol", symbol);
  if (error) throw cloudError("remove from", error);
  return symbol;
}

export type WatchlistMutationQueue = {
  run<T>(symbol: string, operation: () => Promise<T>): Promise<T>;
};

/** Serialize writes per symbol while allowing unrelated symbols in parallel. */
export function createWatchlistMutationQueue(): WatchlistMutationQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    run<T>(symbol: string, operation: () => Promise<T>): Promise<T> {
      const key = normalizeWatchlistSymbol(symbol) ?? symbol;
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(operation);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.finally(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
