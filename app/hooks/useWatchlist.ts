"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import {
  buildWatchlistReconciliationPlan,
  createWatchlistDeviceMessage,
  createWatchlistMutationQueue,
  deleteCloudWatchlistSymbol,
  initializeStoredWatchlist,
  normalizeWatchlistSymbol,
  normalizeWatchlistSymbols,
  parseWatchlistDeviceMessage,
  parseStoredWatchlist,
  readCloudWatchlist,
  readWatchlistSyncSnapshot,
  setWatchlistMembership,
  setWatchlistSnapshotMembership,
  setWatchlistSnapshotTombstone,
  upsertCloudWatchlistSymbol,
  WATCHLIST_BROADCAST_CHANNEL,
  WATCHLIST_CHANGED_EVENT,
  watchlistStorageKey,
  writeStoredWatchlist,
  writeWatchlistSyncSnapshot,
  type WatchlistSyncSnapshot,
} from "@/lib/watchlist";

type WatchlistSyncState = "loading" | "local" | "syncing" | "synced" | "error";

type UseWatchlistOptions = {
  /** Omit to follow the shared Supabase auth session; pass null for guest-only. */
  userId?: string | null;
  client?: SupabaseClient;
};

function sameSymbols(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function useWatchlist(options: UseWatchlistOptions = {}) {
  const client = options.client ?? supabase;
  const followsAuthSession = options.userId === undefined;
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!followsAuthSession);
  const userId = followsAuthSession ? authUserId : options.userId ?? null;
  const activeStorageKey = watchlistStorageKey(userId);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const localReady = authReady && loadedStorageKey === activeStorageKey;
  const [syncState, setSyncState] = useState<WatchlistSyncState>("loading");
  const [error, setError] = useState<string | null>(null);
  const symbolsRef = useRef<string[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const snapshotRef = useRef<WatchlistSyncSnapshot | null>(null);
  const snapshotUserRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(userId);
  const activeStorageKeyRef = useRef(activeStorageKey);
  const mutationQueueRef = useRef(createWatchlistMutationQueue());
  const pendingCloudWorkRef = useRef(new Map<string, number>());
  const cloudWorkErrorRef = useRef(new Map<string, string | null>());
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const applyExternal = useCallback((storageKey: string, value: unknown) => {
    if (storageKey !== activeStorageKeyRef.current) return;
    const next = normalizeWatchlistSymbols(value);
    if (sameSymbols(symbolsRef.current, next)) return;
    symbolsRef.current = next;
    setSymbols(next);
  }, []);

  const publishLocal = useCallback((
    value: unknown,
    targetUserId: string | null = userIdRef.current,
  ) => {
    const next = writeStoredWatchlist(
      window.localStorage,
      value,
      targetUserId,
    );
    const message = createWatchlistDeviceMessage(targetUserId, next);
    if (message.storageKey === activeStorageKeyRef.current) {
      symbolsRef.current = next;
      setSymbols(next);
    }
    window.dispatchEvent(
      new CustomEvent(WATCHLIST_CHANGED_EVENT, { detail: message }),
    );
    channelRef.current?.postMessage(message);
    return next;
  }, []);

  const getSnapshot = useCallback((activeUserId: string) => {
    if (snapshotUserRef.current !== activeUserId) {
      snapshotUserRef.current = activeUserId;
      snapshotRef.current = readWatchlistSyncSnapshot(
        window.localStorage,
        activeUserId,
      );
    }
    return snapshotRef.current;
  }, []);

  const persistSnapshot = useCallback((snapshot: WatchlistSyncSnapshot) => {
    const persisted = writeWatchlistSyncSnapshot(window.localStorage, snapshot);
    if (snapshotUserRef.current === snapshot.userId) {
      snapshotRef.current = persisted;
    }
    return persisted;
  }, []);

  const beginCloudWork = useCallback((activeUserId: string) => {
    const pending = pendingCloudWorkRef.current.get(activeUserId) ?? 0;
    if (pending === 0) cloudWorkErrorRef.current.set(activeUserId, null);
    pendingCloudWorkRef.current.set(activeUserId, pending + 1);
    if (userIdRef.current === activeUserId) setSyncState("syncing");
  }, []);

  const finishCloudWork = useCallback((
    activeUserId: string,
    message: string | null,
  ) => {
    if (message) cloudWorkErrorRef.current.set(activeUserId, message);
    const pending = Math.max(
      0,
      (pendingCloudWorkRef.current.get(activeUserId) ?? 0) - 1,
    );
    pendingCloudWorkRef.current.set(activeUserId, pending);
    if (pending > 0 || userIdRef.current !== activeUserId) return;

    const cloudError = cloudWorkErrorRef.current.get(activeUserId);
    if (cloudError) {
      setSyncState("error");
      setError(cloudError);
      return;
    }
    setSyncState("synced");
    setError(null);
  }, []);

  const runCloudMembership = useCallback(async (
    activeUserId: string,
    symbol: string,
    watched: boolean,
  ) => {
    beginCloudWork(activeUserId);
    let failure: string | null = null;
    try {
      await mutationQueueRef.current.run(symbol, async () => {
        if (watched) {
          await upsertCloudWatchlistSymbol(client, activeUserId, symbol);
        } else {
          await deleteCloudWatchlistSymbol(client, activeUserId, symbol);
        }

        const currentSnapshot = getSnapshot(activeUserId) ?? {
          version: 1,
          userId: activeUserId,
          syncedSymbols: [],
          tombstones: [],
        };
        persistSnapshot(
          setWatchlistSnapshotMembership(currentSnapshot, symbol, watched),
        );
      });
      return true;
    } catch (caught: unknown) {
      failure =
        caught instanceof Error
          ? caught.message
          : "Cloud watchlist update failed.";
      return false;
    } finally {
      finishCloudWork(activeUserId, failure);
    }
  }, [
    beginCloudWork,
    client,
    finishCloudWork,
    getSnapshot,
    persistSnapshot,
  ]);

  useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(WATCHLIST_BROADCAST_CHANNEL);
    channelRef.current = channel;

    const onStorage = (event: StorageEvent) => {
      if (event.key === activeStorageKeyRef.current) {
        applyExternal(event.key, parseStoredWatchlist(event.newValue));
      }
    };
    const onLocalChange = (event: Event) => {
      const message = parseWatchlistDeviceMessage(
        (event as CustomEvent<unknown>).detail,
      );
      if (message) applyExternal(message.storageKey, message.symbols);
    };
    const onBroadcast = (event: MessageEvent<unknown>) => {
      const message = parseWatchlistDeviceMessage(event.data);
      if (message) applyExternal(message.storageKey, message.symbols);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(WATCHLIST_CHANGED_EVENT, onLocalChange);
    channel?.addEventListener("message", onBroadcast);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(WATCHLIST_CHANGED_EVENT, onLocalChange);
      channel?.removeEventListener("message", onBroadcast);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [applyExternal]);

  useEffect(() => {
    if (!followsAuthSession) return;
    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuthUserId(data.session?.user.id ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthUserId(session?.user.id ?? null);
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client, followsAuthSession]);

  useEffect(() => {
    userIdRef.current = userId;
    activeStorageKeyRef.current = activeStorageKey;
  }, [activeStorageKey, userId]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const initialRead = window.setTimeout(() => {
      if (activeStorageKeyRef.current !== activeStorageKey) return;
      const initialized = initializeStoredWatchlist(
        window.localStorage,
        userId,
      );
      symbolsRef.current = initialized.symbols;
      setSymbols(initialized.symbols);
      setLoadedStorageKey(initialized.storageKey);
      setSyncState(userId ? "syncing" : "local");
      setError(null);

      snapshotUserRef.current = userId;
      snapshotRef.current = userId
        ? readWatchlistSyncSnapshot(window.localStorage, userId)
        : null;
      refreshInFlightRef.current = null;
    }, 0);

    return () => window.clearTimeout(initialRead);
  }, [activeStorageKey, authReady, userId]);

  const refresh = useCallback((): Promise<void> => {
    if (!localReady || !authReady) return Promise.resolve();
    if (!userId) {
      setSyncState("local");
      setError(null);
      return Promise.resolve();
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const activeUserId = userId;
    const task = (async () => {
      beginCloudWork(activeUserId);
      let failure: string | null = null;
      try {
        const cloudSymbols = await readCloudWatchlist(client, activeUserId);
        if (userIdRef.current !== activeUserId) return;

        const previousSnapshot = getSnapshot(activeUserId);
        const plan = buildWatchlistReconciliationPlan(
          symbolsRef.current,
          cloudSymbols,
          previousSnapshot,
        );

        // Anchor the next reconciliation to cloud membership actually read.
        // Device-only additions/deletions remain derivable from local state and
        // unresolved deletion markers until their single-symbol write succeeds.
        persistSnapshot({
          version: 1,
          userId: activeUserId,
          syncedSymbols: cloudSymbols,
          tombstones: previousSnapshot?.tombstones ?? [],
        });
        publishLocal(plan.symbols, activeUserId);

        const results = await Promise.all([
          ...plan.cloudUpserts.map((symbol) =>
            runCloudMembership(activeUserId, symbol, true),
          ),
          ...plan.cloudDeletes.map((symbol) =>
            runCloudMembership(activeUserId, symbol, false),
          ),
        ]);
        if (results.some((succeeded) => !succeeded)) {
          failure = "One or more cloud watchlist changes could not be synchronized.";
        }
      } catch (caught: unknown) {
        failure =
          caught instanceof Error
            ? caught.message
            : "Cloud watchlist unavailable.";
      } finally {
        finishCloudWork(activeUserId, failure);
      }
    })();

    refreshInFlightRef.current = task;
    void task.finally(() => {
      if (refreshInFlightRef.current === task) {
        refreshInFlightRef.current = null;
      }
    });
    return task;
  }, [
    authReady,
    beginCloudWork,
    client,
    finishCloudWork,
    getSnapshot,
    localReady,
    persistSnapshot,
    publishLocal,
    runCloudMembership,
    userId,
  ]);

  useEffect(() => {
    if (!localReady || !authReady) return;
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [authReady, localReady, refresh, userId]);

  const changeMembership = useCallback(async (value: unknown, watched: boolean) => {
    if (!localReady) return false;
    const symbol = normalizeWatchlistSymbol(value);
    if (!symbol) return false;

    const previous = symbolsRef.current;
    const next = setWatchlistMembership(previous, symbol, watched);
    if (sameSymbols(previous, next)) return true;

    publishLocal(next, userId);
    setError(null);

    if (!userId) {
      setSyncState("local");
      return true;
    }

    const snapshot = getSnapshot(userId);
    if (snapshot) {
      persistSnapshot(
        setWatchlistSnapshotTombstone(snapshot, symbol, !watched),
      );
    }

    // Keep the optimistic device intent on transient failures. The snapshot
    // diff/tombstone makes the next refresh retry it instead of silently
    // rolling the UI back or resurrecting a cross-device deletion.
    return runCloudMembership(userId, symbol, watched);
  }, [
    getSnapshot,
    localReady,
    persistSnapshot,
    publishLocal,
    runCloudMembership,
    userId,
  ]);

  const add = useCallback(
    (symbol: unknown) => changeMembership(symbol, true),
    [changeMembership],
  );
  const remove = useCallback(
    (symbol: unknown) => changeMembership(symbol, false),
    [changeMembership],
  );
  const toggle = useCallback((value: unknown) => {
    if (!localReady) return Promise.resolve(false);
    const symbol = normalizeWatchlistSymbol(value);
    if (!symbol) return Promise.resolve(false);
    return changeMembership(symbol, !symbolsRef.current.includes(symbol));
  }, [changeMembership, localReady]);
  const has = useCallback((value: unknown) => {
    if (!localReady) return false;
    const symbol = normalizeWatchlistSymbol(value);
    return Boolean(symbol && symbolsRef.current.includes(symbol));
  }, [localReady]);

  const visibleSymbols = useMemo(
    () => (localReady ? symbols : []),
    [localReady, symbols],
  );

  return useMemo(() => ({
    symbols: visibleSymbols,
    watchlist: visibleSymbols,
    add,
    remove,
    toggle,
    has,
    refresh,
    loading: !localReady || !authReady || syncState === "syncing",
    localReady,
    cloudEnabled: Boolean(userId),
    syncState,
    error,
  }), [
    add,
    authReady,
    error,
    has,
    localReady,
    refresh,
    remove,
    visibleSymbols,
    syncState,
    toggle,
    userId,
  ]);
}
