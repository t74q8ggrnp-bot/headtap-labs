"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RequestWindow = {
  apiRequestCount: number;
  apiRequestsByPath: Record<string, number>;
};

type BaselineSnapshot = {
  schemaVersion: 1;
  route: string;
  viewport: { width: number; height: number };
  elapsedMs: number;
  horizontalOverflowPx: number;
  initial5s: RequestWindow;
  observed: RequestWindow;
};

declare global {
  interface Window {
    __HT_PHASE25_BASELINE__?: BaselineSnapshot;
  }
}

function summarize(entries: PerformanceResourceTiming[], maximumStartTime = Number.POSITIVE_INFINITY): RequestWindow {
  const paths = entries
    .filter((entry) => entry.startTime <= maximumStartTime)
    .map((entry) => {
      try {
        const url = new URL(entry.name);
        return url.origin === window.location.origin && url.pathname.startsWith("/api/")
          ? `${url.pathname}${url.search}`
          : null;
      } catch {
        return null;
      }
    })
    .filter((path): path is string => Boolean(path));

  return {
    apiRequestCount: paths.length,
    apiRequestsByPath: paths.reduce<Record<string, number>>((counts, path) => {
      counts[path] = (counts[path] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function collectSnapshot(): BaselineSnapshot {
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const elapsedMs = Math.round(performance.now());
  return {
    schemaVersion: 1,
    route: `${window.location.pathname}${window.location.search.replace(/([?&])htBaseline=requests(&?)/, "$1").replace(/[?&]$/, "")}`,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    elapsedMs,
    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    initial5s: summarize(entries, 5_000),
    observed: summarize(entries, elapsedMs),
  };
}

export default function Phase25BaselineProbe() {
  return (
    <>
      <RequestBaselineProbe />
      <ViewportProbe />
    </>
  );
}

function RequestBaselineProbe() {
  const [snapshot, setSnapshot] = useState<BaselineSnapshot | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("htBaseline") !== "requests") return;
    const update = () => {
      const next = collectSnapshot();
      window.__HT_PHASE25_BASELINE__ = next;
      setSnapshot(next);
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!snapshot) return null;
  return (
    <output
      className="fixed bottom-20 right-3 z-[2000] max-h-[45vh] max-w-[calc(100vw-1.5rem)] overflow-auto rounded-lg border border-cyan-400/30 bg-black/95 p-3 font-mono text-[10px] text-cyan-200 shadow-2xl"
      aria-label="Phase 2.5 request baseline"
    >
      {JSON.stringify(snapshot)}
    </output>
  );
}

type ViewportProbeSnapshot = {
  target: string;
  viewport: { width: number; height: number };
  applicationRoute: string | null;
  horizontalOverflowPx: number;
  mobileCurrent: string | null;
  exactCurrentHref: string | null;
  navigationBounds: { left: number; right: number; top: number; bottom: number } | null;
};

function ViewportProbe() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [config, setConfig] = useState<{ target: string; width: number; height: number } | null>(null);
  const [snapshot, setSnapshot] = useState<ViewportProbeSnapshot | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const match = params.get("htViewport")?.match(/^(\d{3,4})x(\d{3,4})$/);
    const requestedTarget = params.get("htRoute");
    if (!match || !requestedTarget?.startsWith("/") || requestedTarget.startsWith("//")) return;
    // This opt-in development harness is configured only after the browser
    // resolves the query string; keeping SSR output empty avoids hydration drift.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfig({
      target: requestedTarget,
      width: Number(match[1]),
      height: Number(match[2]),
    });
  }, []);

  const measure = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    const view = frame?.contentWindow;
    if (!frame || !doc || !view || !config) return;
    const nav = doc.querySelector<HTMLElement>(".ht-mobile-global-nav");
    const bounds = nav?.getBoundingClientRect();
    const exactCurrent = doc.querySelector<HTMLAnchorElement>(".ht-mobile-route-link[aria-current='page']");
    setSnapshot({
      target: config.target,
      viewport: { width: view.innerWidth, height: view.innerHeight },
      applicationRoute: doc.querySelector<HTMLElement>("[data-application-route]")?.dataset.applicationRoute ?? null,
      horizontalOverflowPx: Math.max(0, doc.documentElement.scrollWidth - doc.documentElement.clientWidth),
      mobileCurrent: doc.querySelector<HTMLElement>(".ht-mobile-global-nav [aria-current='page']")?.textContent?.trim() ?? null,
      exactCurrentHref: exactCurrent?.getAttribute("href") ?? null,
      navigationBounds: bounds ? {
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
        top: Math.round(bounds.top),
        bottom: Math.round(bounds.bottom),
      } : null,
    });
  }, [config]);

  useEffect(() => {
    if (!config) return;
    const timer = window.setInterval(measure, 500);
    return () => window.clearInterval(timer);
  }, [config, measure]);

  if (!config) return null;
  return (
    <div className="fixed inset-0 z-[2050] overflow-auto bg-zinc-950 p-4 text-white">
      <iframe
        ref={iframeRef}
        title={`Checkpoint C viewport ${config.width} by ${config.height}`}
        src={config.target}
        width={config.width}
        height={config.height}
        onLoad={measure}
        className="box-content block border border-white/20 bg-black"
      />
      <output className="mt-3 block max-w-4xl whitespace-pre-wrap rounded-lg border border-cyan-400/30 bg-black p-3 font-mono text-xs text-cyan-200" aria-label="Checkpoint C viewport measurement">
        {snapshot ? JSON.stringify(snapshot) : "Measuring viewport…"}
      </output>
    </div>
  );
}
