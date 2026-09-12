"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import DesktopTerminalNavigation from "./DesktopTerminalNavigation";
import { useDesktopTerminalLayout } from "@/app/hooks/useDesktopTerminalLayout";
import { resolveDesktopTerminalLayout } from "@/lib/desktop-terminal-layout";

function ResizeHandle({
  label,
  value,
  minimum,
  maximum,
  direction,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  direction: 1 | -1;
  onChange: (value: number) => void;
}) {
  const start = useRef<{ x: number; value: number } | null>(null);
  const updateFromKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? step : -step;
      onChange(value + delta * direction);
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(minimum);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(maximum);
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, value };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(start.current.value + (event.clientX - start.current.x) * direction);
  };
  const clear = () => { start.current = null; };
  return (
    <div
      className="ht-terminal-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={updateFromKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clear}
      onLostPointerCapture={clear}
    />
  );
}

export default function DesktopTerminalFrame({
  markets,
  instrumentHeader,
  chart,
  intelligence,
  marketsTitle = "Markets",
  intelligenceTitle = "HT Intelligence",
}: {
  markets: ReactNode;
  instrumentHeader: ReactNode;
  chart: ReactNode;
  intelligence: ReactNode;
  marketsTitle?: string;
  intelligenceTitle?: string;
}) {
  const { preferences, resetLayout, setPane, setPaneWidth } = useDesktopTerminalLayout();
  const frameRef = useRef<HTMLDivElement>(null);
  const marketsPaneRef = useRef<HTMLElement>(null);
  const intelligencePaneRef = useRef<HTMLElement>(null);
  const marketsHandleRef = useRef<HTMLButtonElement>(null);
  const intelligenceHandleRef = useRef<HTMLButtonElement>(null);
  const marketsCollapseRef = useRef<HTMLButtonElement>(null);
  const intelligenceCollapseRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(1440);
  const prefix = useId().replaceAll(":", "");
  const layout = useMemo(
    () => resolveDesktopTerminalLayout(width, preferences),
    [preferences, width],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setWidth(frame.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const active = document.activeElement;
    if (!layout.marketsOpen && active && marketsPaneRef.current?.contains(active)) {
      marketsHandleRef.current?.focus();
    }
    if (!layout.intelligenceOpen && active && intelligencePaneRef.current?.contains(active)) {
      intelligenceHandleRef.current?.focus();
    }
  }, [layout.intelligenceOpen, layout.marketsOpen]);

  const collapse = (pane: "markets" | "intelligence") => {
    setPane(pane, "closed");
    window.requestAnimationFrame(() => (pane === "markets" ? marketsHandleRef : intelligenceHandleRef).current?.focus());
  };
  const expand = (pane: "markets" | "intelligence") => {
    setPane(pane, "open");
    window.requestAnimationFrame(() => (pane === "markets" ? marketsCollapseRef : intelligenceCollapseRef).current?.focus());
  };

  const style = {
    "--ht-terminal-markets-width": `${layout.marketsOpen ? layout.marketsWidth : 30}px`,
    "--ht-terminal-intelligence-width": `${layout.intelligenceOpen ? layout.intelligenceWidth : 30}px`,
  } as CSSProperties;

  return (
    <div
      ref={frameRef}
      className="ht-terminal"
      style={style}
      data-markets-open={layout.marketsOpen ? "true" : "false"}
      data-intelligence-open={layout.intelligenceOpen ? "true" : "false"}
    >
      <DesktopTerminalNavigation onResetLayout={resetLayout} />
      <aside
        ref={marketsPaneRef}
        id={`${prefix}-markets-pane`}
        className="ht-terminal-pane ht-terminal-pane--markets"
        aria-label={marketsTitle}
        aria-hidden={layout.terminal && !layout.marketsOpen}
        inert={layout.terminal && !layout.marketsOpen}
      >
        <header className="ht-terminal-pane__header">
          <h2>{marketsTitle}</h2>
          <button ref={marketsCollapseRef} type="button" onClick={() => collapse("markets")} aria-label="Collapse Markets pane">‹</button>
        </header>
        <div className="ht-terminal-pane__body">{markets}</div>
        <ResizeHandle label="Resize Markets pane" value={layout.marketsWidth} minimum={210} maximum={260} direction={1} onChange={(value) => setPaneWidth("markets", value)} />
      </aside>
      {layout.terminal && !layout.marketsOpen ? (
        <button ref={marketsHandleRef} type="button" className="ht-terminal-pane-handle ht-terminal-pane-handle--markets" aria-label="Expand Markets pane" aria-controls={`${prefix}-markets-pane`} aria-expanded="false" onClick={() => expand("markets")}>
          <span aria-hidden="true">▦</span>
        </button>
      ) : null}
      <section className="ht-terminal-workspace" aria-label="Market chart workspace">
        <div className="ht-terminal-instrument">{instrumentHeader}</div>
        <div className="ht-terminal-chart">{chart}</div>
      </section>
      <aside
        ref={intelligencePaneRef}
        id={`${prefix}-intelligence-pane`}
        className="ht-terminal-pane ht-terminal-pane--intelligence"
        aria-label={intelligenceTitle}
        aria-hidden={layout.terminal && !layout.intelligenceOpen}
        inert={layout.terminal && !layout.intelligenceOpen}
      >
        <ResizeHandle label="Resize HT Intelligence pane" value={layout.intelligenceWidth} minimum={280} maximum={360} direction={-1} onChange={(value) => setPaneWidth("intelligence", value)} />
        <header className="ht-terminal-pane__header">
          <h2>{intelligenceTitle}</h2>
          <button ref={intelligenceCollapseRef} type="button" onClick={() => collapse("intelligence")} aria-label="Collapse HT Intelligence pane">›</button>
        </header>
        <div className="ht-terminal-pane__body">{intelligence}</div>
      </aside>
      {layout.terminal && !layout.intelligenceOpen ? (
        <button ref={intelligenceHandleRef} type="button" className="ht-terminal-pane-handle ht-terminal-pane-handle--intelligence" aria-label="Expand HT Intelligence pane" aria-controls={`${prefix}-intelligence-pane`} aria-expanded="false" onClick={() => expand("intelligence")}>
          <span aria-hidden="true">HT</span>
        </button>
      ) : null}
    </div>
  );
}
