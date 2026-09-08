import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWatchlistMergePlan,
  buildWatchlistReconciliationPlan,
  createWatchlistDeviceMessage,
  createWatchlistMutationQueue,
  deleteCloudWatchlistSymbol,
  initializeStoredWatchlist,
  normalizeWatchlistSymbol,
  normalizeWatchlistSymbols,
  parseStoredWatchlist,
  parseWatchlistDeviceMessage,
  parseWatchlistSyncSnapshot,
  readCloudWatchlist,
  readStoredWatchlist,
  readWatchlistSyncSnapshot,
  setWatchlistMembership,
  setWatchlistSnapshotMembership,
  setWatchlistSnapshotTombstone,
  upsertCloudWatchlistSymbol,
  WATCHLIST_GUEST_MIGRATION_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  watchlistStorageKey,
  watchlistSyncStorageKey,
  writeStoredWatchlist,
  writeWatchlistSyncSnapshot,
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
} from "./watchlist.ts";

test("watchlist symbols are normalized without inventing ticker repairs", () => {
  assert.equal(normalizeWatchlistSymbol(" brk.b "), "BRK.B");
  assert.equal(normalizeWatchlistSymbol("spy"), "SPY");
  assert.equal(normalizeWatchlistSymbol("BAD SYMBOL"), null);
  assert.equal(normalizeWatchlistSymbol(""), null);
  assert.equal(normalizeWatchlistSymbol(42), null);
  assert.deepEqual(
    normalizeWatchlistSymbols(["spy", " SPY ", "qqq", null, "bad symbol"]),
    ["SPY", "QQQ"],
  );
});

test("stored watchlists recover from malformed and mixed legacy values", () => {
  assert.deepEqual(parseStoredWatchlist("not-json"), []);
  assert.deepEqual(parseStoredWatchlist(JSON.stringify({ symbol: "SPY" })), []);
  assert.deepEqual(
    parseStoredWatchlist(JSON.stringify(["qqq", 3, "QQQ", "aapl"])),
    ["QQQ", "AAPL"],
  );
});

test("device and cloud lists merge deterministically without cloud deletes", () => {
  assert.deepEqual(
    buildWatchlistMergePlan(["QQQ", "AAPL"], ["SPY", "AAPL", "IWM"]),
    {
      symbols: ["QQQ", "AAPL", "IWM", "SPY"],
      cloudUpserts: ["QQQ"],
    },
  );
});

test("a synchronized device honors deletions on either side instead of resurrecting them", () => {
  const snapshot = {
    version: 1 as const,
    userId: "user-1",
    syncedSymbols: ["SPY", "QQQ"],
    tombstones: [],
  };

  assert.deepEqual(
    buildWatchlistReconciliationPlan(
      ["SPY", "QQQ", "AAPL"],
      ["QQQ", "IWM"],
      snapshot,
    ),
    {
      mode: "three_way",
      symbols: ["QQQ", "AAPL", "IWM"],
      cloudUpserts: ["AAPL"],
      cloudDeletes: [],
    },
  );

  assert.deepEqual(
    buildWatchlistReconciliationPlan(
      ["QQQ"],
      ["SPY", "QQQ"],
      snapshot,
    ),
    {
      mode: "three_way",
      symbols: ["QQQ"],
      cloudUpserts: [],
      cloudDeletes: ["SPY"],
    },
  );
});

test("first account sync is additive, while tombstones survive until cloud confirms", () => {
  assert.deepEqual(
    buildWatchlistReconciliationPlan(["AAPL"], ["SPY"], null),
    {
      mode: "guest_migration",
      symbols: ["AAPL", "SPY"],
      cloudUpserts: ["AAPL"],
      cloudDeletes: [],
    },
  );

  const base = {
    version: 1 as const,
    userId: "user-1",
    syncedSymbols: ["SPY"],
    tombstones: [],
  };
  const pending = setWatchlistSnapshotTombstone(base, "spy", true);
  assert.deepEqual(pending.tombstones, ["SPY"]);
  assert.deepEqual(
    buildWatchlistReconciliationPlan(["SPY"], ["SPY"], pending).symbols,
    [],
  );
  assert.deepEqual(
    setWatchlistSnapshotMembership(pending, "SPY", false),
    {
      ...base,
      syncedSymbols: [],
    },
  );
});

test("sync snapshots are scoped to one account and tolerate unavailable storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
  };
  const snapshot = writeWatchlistSyncSnapshot(storage, {
    version: 1,
    userId: "user-1",
    syncedSymbols: ["spy", "SPY"],
    tombstones: ["qqq"],
  });

  assert.deepEqual(snapshot.syncedSymbols, ["SPY"]);
  assert.equal(
    values.has(watchlistSyncStorageKey("user-1")),
    true,
  );
  assert.deepEqual(readWatchlistSyncSnapshot(storage, "user-1"), snapshot);
  assert.equal(readWatchlistSyncSnapshot(storage, "user-2"), null);
  assert.equal(parseWatchlistSyncSnapshot("not-json", "user-1"), null);
});

test("membership changes only the requested symbol", () => {
  assert.deepEqual(setWatchlistMembership(["SPY"], "qqq", true), ["SPY", "QQQ"]);
  assert.deepEqual(setWatchlistMembership(["SPY", "QQQ"], "spy", false), ["QQQ"]);
  assert.deepEqual(setWatchlistMembership(["SPY"], "bad symbol", true), ["SPY"]);
});

test("storage helpers normalize writes and fail closed on storage errors", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  assert.deepEqual(writeStoredWatchlist(storage, ["spy", "SPY", "qqq"]), ["SPY", "QQQ"]);
  assert.equal(values.get(WATCHLIST_STORAGE_KEY), '["SPY","QQQ"]');
  assert.deepEqual(readStoredWatchlist(storage), ["SPY", "QQQ"]);

  const unavailable = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readStoredWatchlist(unavailable), []);
  assert.deepEqual(writeStoredWatchlist(unavailable, ["spy"]), ["SPY"]);
});

test("authenticated device lists are isolated and guest state migrates only once", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };

  writeStoredWatchlist(storage, ["spy"]);
  assert.equal(
    values.get(WATCHLIST_GUEST_MIGRATION_STORAGE_KEY),
    '{"version":1,"claimedBy":null}',
  );

  const firstAccount = initializeStoredWatchlist(storage, "user/a");
  assert.deepEqual(firstAccount, {
    storageKey: watchlistStorageKey("user/a"),
    symbols: ["SPY"],
    migratedGuest: true,
  });
  assert.equal(
    values.get(WATCHLIST_GUEST_MIGRATION_STORAGE_KEY),
    '{"version":1,"claimedBy":"user/a"}',
  );

  writeStoredWatchlist(storage, ["AAPL"], "user/a");
  const secondAccount = initializeStoredWatchlist(storage, "user-b");
  assert.deepEqual(secondAccount, {
    storageKey: watchlistStorageKey("user-b"),
    symbols: [],
    migratedGuest: false,
  });
  assert.deepEqual(readStoredWatchlist(storage, "user/a"), ["AAPL"]);
  assert.deepEqual(readStoredWatchlist(storage, "user-b"), []);
  assert.deepEqual(readStoredWatchlist(storage), []);

  // A later intentional guest edit is claimable by a brand-new account, but
  // never by an account that already has an initialized (even empty) scope.
  writeStoredWatchlist(storage, ["qqq"]);
  assert.equal(initializeStoredWatchlist(storage, "user-b").migratedGuest, false);
  assert.deepEqual(initializeStoredWatchlist(storage, "user-c"), {
    storageKey: watchlistStorageKey("user-c"),
    symbols: ["QQQ"],
    migratedGuest: true,
  });
});

test("legacy guest migration is additive-safe and malformed claims fail closed", () => {
  const values = new Map<string, string>([
    [WATCHLIST_STORAGE_KEY, '["IWM"]'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
  };

  assert.equal(initializeStoredWatchlist(storage, "legacy-user").migratedGuest, true);
  assert.equal(initializeStoredWatchlist(storage, "other-user").migratedGuest, false);

  values.set(WATCHLIST_GUEST_MIGRATION_STORAGE_KEY, "not-json");
  values.delete(watchlistStorageKey("locked-user"));
  assert.deepEqual(initializeStoredWatchlist(storage, "locked-user"), {
    storageKey: watchlistStorageKey("locked-user"),
    symbols: [],
    migratedGuest: false,
  });
});

test("an ambiguous legacy list cannot cross into a different account", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
  };

  // This reproduces the pre-Phase-1 state: account A wrote the global key and
  // has a sync snapshot, then account B becomes the active account.
  values.set(WATCHLIST_STORAGE_KEY, '["AAPL"]');
  writeWatchlistSyncSnapshot(storage, {
    version: 1,
    userId: "user-a",
    syncedSymbols: ["AAPL"],
    tombstones: [],
  });

  assert.deepEqual(initializeStoredWatchlist(storage, "user-b"), {
    storageKey: watchlistStorageKey("user-b"),
    symbols: [],
    migratedGuest: false,
  });
  assert.deepEqual(readStoredWatchlist(storage, "user-a"), []);
  assert.deepEqual(readStoredWatchlist(storage, "user-b"), []);
  assert.deepEqual(readStoredWatchlist(storage), ["AAPL"]);
});

test("cross-tab messages carry an account scope and reject legacy payloads", () => {
  const first = createWatchlistDeviceMessage("user-1", ["spy", "SPY"]);
  const second = createWatchlistDeviceMessage("user-2", ["qqq"]);
  const guest = createWatchlistDeviceMessage(null, ["iwm"]);

  assert.notEqual(first.storageKey, second.storageKey);
  assert.notEqual(first.storageKey, guest.storageKey);
  assert.deepEqual(parseWatchlistDeviceMessage(first), first);
  assert.deepEqual(parseWatchlistDeviceMessage(["SPY"]), null);
  assert.deepEqual(parseWatchlistDeviceMessage({ version: 1, symbols: ["SPY"] }), null);
});

test("cloud persistence uses exact reads and owner-scoped single-symbol operations", async () => {
  const operations: unknown[] = [];
  let existingRows: Array<{ symbol: string }> = [];
  const client = {
    from(table: string) {
      operations.push(["from", table]);
      return {
        select(columns: string) {
          operations.push(["select", columns]);
          const filters: Array<[string, string]> = [];
          const builder = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              operations.push(["select-eq", column, value]);
              return builder;
            },
            async limit(value: number) {
              operations.push(["limit", value]);
              return { data: existingRows, error: null };
            },
            then(resolve: (value: unknown) => void) {
              resolve({
                data: [{ symbol: "spy" }, { symbol: "QQQ" }],
                error: null,
              });
            },
          };
          return builder;
        },
        async insert(row: unknown) {
          operations.push(["insert", row]);
          return { error: null };
        },
        delete() {
          operations.push(["delete"]);
          return {
            eq(column: string, value: string) {
              operations.push(["delete-eq", column, value]);
              return {
                async eq(nextColumn: string, nextValue: string) {
                  operations.push(["delete-eq", nextColumn, nextValue]);
                  return { error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  assert.deepEqual(await readCloudWatchlist(client as never, "user-1"), ["QQQ", "SPY"]);
  assert.equal(await upsertCloudWatchlistSymbol(client as never, "user-1", " aapl "), "AAPL");
  assert.equal(await deleteCloudWatchlistSymbol(client as never, "user-1", " spy "), "SPY");
  assert.deepEqual(operations.slice(-4), [
    ["from", "ht_labs_watchlist"],
    ["delete"],
    ["delete-eq", "user_id", "user-1"],
    ["delete-eq", "symbol", "SPY"],
  ]);
  assert.ok(operations.some((operation) =>
    JSON.stringify(operation) === '["select-eq","symbol","AAPL"]'
  ));
  assert.ok(operations.some((operation) =>
    JSON.stringify(operation) ===
      '["insert",{"user_id":"user-1","symbol":"AAPL"}]'
  ));

  const insertCount = operations.filter((operation) =>
    JSON.stringify(operation).startsWith('["insert"')
  ).length;
  existingRows = [{ symbol: "AAPL" }];
  assert.equal(await upsertCloudWatchlistSymbol(client as never, "user-1", "aapl"), "AAPL");
  assert.equal(
    operations.filter((operation) =>
      JSON.stringify(operation).startsWith('["insert"')
    ).length,
    insertCount,
  );
});

test("a concurrent unique violation is accepted as an idempotent insert", async () => {
  const client = {
    from() {
      return {
        select() {
          const builder = {
            eq() {
              return builder;
            },
            async limit() {
              return { data: [], error: null };
            },
          };
          return builder;
        },
        async insert() {
          return {
            error: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
            },
          };
        },
      };
    },
  };

  assert.equal(
    await upsertCloudWatchlistSymbol(client as never, "user-1", "SPY"),
    "SPY",
  );
});

test("same-symbol cloud mutations finish in the order they were requested", async () => {
  const queue = createWatchlistMutationQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run("SPY", async () => {
    events.push("add:start");
    await firstGate;
    events.push("add:end");
  });
  const second = queue.run("spy", async () => {
    events.push("remove:start");
    events.push("remove:end");
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["add:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "add:start",
    "add:end",
    "remove:start",
    "remove:end",
  ]);
});
