"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TERMINAL_WORKSPACE_PREFERENCES,
  mergeTerminalWorkspacePreferences,
  parseTerminalWorkspacePreferences,
  TERMINAL_WORKSPACE_PREFERENCES_KEY,
  type TerminalWorkspacePreferences,
} from "@/lib/terminal-workspace-preferences";

const EVENT_NAME = "htlabs:terminal-workspace-updated";

function readPreferences(fallback: TerminalWorkspacePreferences) {
  try {
    return parseTerminalWorkspacePreferences(
      JSON.parse(window.localStorage.getItem(TERMINAL_WORKSPACE_PREFERENCES_KEY) ?? "null"),
      fallback,
    );
  } catch {
    return fallback;
  }
}

export function useTerminalWorkspacePreferences(
  fallback: TerminalWorkspacePreferences = DEFAULT_TERMINAL_WORKSPACE_PREFERENCES,
) {
  const [preferences, setPreferences] = useState(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = () => {
      setPreferences(readPreferences(fallback));
      setHydrated(true);
    };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT_NAME, sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT_NAME, sync);
    };
  }, [fallback]);

  const update = useCallback((patch: Partial<TerminalWorkspacePreferences>) => {
    setPreferences((current) => {
      const next = mergeTerminalWorkspacePreferences(current, patch);
      try {
        window.localStorage.setItem(TERMINAL_WORKSPACE_PREFERENCES_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(EVENT_NAME));
      } catch {
        // Device-local continuity is optional; the current tab remains usable.
      }
      return next;
    });
  }, []);

  return { preferences, update, hydrated };
}
