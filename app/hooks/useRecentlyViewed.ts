"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addRecentlyViewedSymbol,
  clearStoredRecentlyViewed,
  normalizeRecentlyViewed,
  parseStoredRecentlyViewed,
  readStoredRecentlyViewed,
  RECENTLY_VIEWED_BROADCAST_CHANNEL,
  RECENTLY_VIEWED_CHANGED_EVENT,
  RECENTLY_VIEWED_STORAGE_KEY,
  removeRecentlyViewedSymbol,
  writeStoredRecentlyViewed,
} from "@/lib/recently-viewed";

function sameSymbols(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function useRecentlyViewed() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const symbolsRef = useRef<string[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const applyExternal = useCallback((value: unknown) => {
    const next = normalizeRecentlyViewed(value);
    if (sameSymbols(symbolsRef.current, next)) return;
    symbolsRef.current = next;
    setSymbols(next);
  }, []);

  const publish = useCallback((value: unknown) => {
    const next = writeStoredRecentlyViewed(window.localStorage, value);
    symbolsRef.current = next;
    setSymbols(next);
    window.dispatchEvent(
      new CustomEvent(RECENTLY_VIEWED_CHANGED_EVENT, { detail: next }),
    );
    channelRef.current?.postMessage(next);
    return next;
  }, []);

  useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(RECENTLY_VIEWED_BROADCAST_CHANNEL);
    channelRef.current = channel;

    const onStorage = (event: StorageEvent) => {
      if (event.key === RECENTLY_VIEWED_STORAGE_KEY) {
        applyExternal(parseStoredRecentlyViewed(event.newValue));
      }
    };
    const onLocalChange = (event: Event) => {
      applyExternal((event as CustomEvent<unknown>).detail);
    };
    const onBroadcast = (event: MessageEvent<unknown>) => applyExternal(event.data);

    window.addEventListener("storage", onStorage);
    window.addEventListener(RECENTLY_VIEWED_CHANGED_EVENT, onLocalChange);
    channel?.addEventListener("message", onBroadcast);

    const initialRead = window.setTimeout(() => {
      const initial = readStoredRecentlyViewed(window.localStorage);
      symbolsRef.current = initial;
      setSymbols(initial);
      setReady(true);
    }, 0);

    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RECENTLY_VIEWED_CHANGED_EVENT, onLocalChange);
      channel?.removeEventListener("message", onBroadcast);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [applyExternal]);

  const record = useCallback(
    (symbol: unknown) => publish(addRecentlyViewedSymbol(symbolsRef.current, symbol)),
    [publish],
  );
  const remove = useCallback(
    (symbol: unknown) => publish(removeRecentlyViewedSymbol(symbolsRef.current, symbol)),
    [publish],
  );
  const clear = useCallback(() => {
    clearStoredRecentlyViewed(window.localStorage);
    symbolsRef.current = [];
    setSymbols([]);
    window.dispatchEvent(
      new CustomEvent(RECENTLY_VIEWED_CHANGED_EVENT, { detail: [] }),
    );
    channelRef.current?.postMessage([]);
  }, []);

  return useMemo(() => ({
    symbols,
    recentlyViewed: symbols,
    record,
    remove,
    clear,
    ready,
  }), [clear, ready, record, remove, symbols]);
}
