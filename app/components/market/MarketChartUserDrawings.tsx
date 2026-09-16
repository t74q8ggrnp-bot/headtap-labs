"use client";

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { IChartApi, Time, UTCTimestamp } from "lightweight-charts";

export type MarketChartUserDrawingTool =
  | "pan"
  | "select"
  | "horizontal"
  | "trend"
  | "measure";

export type MarketChartUserDrawingPoint = {
  time: number;
  price: number;
};

export type MarketChartUserDrawing = {
  id: string;
  kind: "horizontal" | "trend" | "measure";
  points: MarketChartUserDrawingPoint[];
};

type CoordinatePriceSeries = {
  priceToCoordinate: (price: number) => number | null;
  coordinateToPrice: (coordinate: number) => number | null;
};

type Props = {
  chart: IChartApi | null;
  series: CoordinatePriceSeries | null;
  drawings: readonly MarketChartUserDrawing[];
  tool: MarketChartUserDrawingTool;
  selectedId: string | null;
  renderVersion: number;
  onSelect: (id: string | null) => void;
  onCommit: (drawings: MarketChartUserDrawing[]) => void;
  onToolComplete: () => void;
};

type DragState = {
  drawing: MarketChartUserDrawing;
  pointIndex: number;
  pointerId: number;
};

function drawingId() {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function numberTime(time: Time | null): number | null {
  return typeof time === "number" && Number.isFinite(time) ? time : null;
}

function drawingLabel(drawing: MarketChartUserDrawing) {
  if (drawing.kind === "horizontal") return `Horizontal line at ${drawing.points[0]?.price.toFixed(2) ?? "unknown"}`;
  if (drawing.kind === "trend") return "Trendline";
  const first = drawing.points[0]?.price ?? 0;
  const second = drawing.points[1]?.price ?? first;
  const change = first === 0 ? 0 : ((second - first) / first) * 100;
  return `Price range ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

export function MarketChartUserDrawingLayer({
  chart,
  series,
  drawings,
  tool,
  selectedId,
  renderVersion,
  onSelect,
  onCommit,
  onToolComplete,
}: Props) {
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const [pendingPoint, setPendingPoint] = useState<MarketChartUserDrawingPoint | null>(null);
  const [draft, setDraft] = useState<MarketChartUserDrawing | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draftRef = useRef<MarketChartUserDrawing | null>(null);
  const activeDrawings = useMemo(
    () => {
      const committed = drawings.map((drawing) => drawing.id === draft?.id ? draft : drawing);
      return draft?.id === "pending" ? [...committed, draft] : committed;
    },
    [draft, drawings],
  );

  void renderVersion;

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement | SVGCircleElement | SVGLineElement>) => {
    const overlay = overlayRef.current;
    if (!overlay || !chart || !series) return null;
    const bounds = overlay.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const time = numberTime(chart.timeScale().coordinateToTime(x));
    const price = series.coordinateToPrice(y);
    if (time === null || price === null || !Number.isFinite(price)) return null;
    return { time, price };
  };

  const createDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!series || !chart || (tool !== "horizontal" && tool !== "trend" && tool !== "measure")) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    if (tool === "horizontal") {
      const drawing: MarketChartUserDrawing = { id: drawingId(), kind: "horizontal", points: [point] };
      onCommit([...drawings, drawing]);
      onSelect(drawing.id);
      onToolComplete();
      return;
    }
    if (!pendingPoint) {
      setPendingPoint(point);
      setDraft(null);
      draftRef.current = null;
      return;
    }
    const drawing: MarketChartUserDrawing = {
      id: drawingId(),
      kind: tool,
      points: [pendingPoint, point],
    };
    setPendingPoint(null);
    setDraft(null);
    draftRef.current = null;
    onCommit([...drawings, drawing]);
    onSelect(drawing.id);
    onToolComplete();
  };

  const beginDrag = (
    event: ReactPointerEvent<SVGCircleElement | SVGLineElement>,
    drawing: MarketChartUserDrawing,
    pointIndex: number,
  ) => {
    if (tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(drawing.id);
    dragRef.current = { drawing, pointIndex, pointerId: event.pointerId };
    setDraft(drawing);
    draftRef.current = drawing;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<SVGCircleElement | SVGLineElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    const points = [...drag.drawing.points];
    if (drag.drawing.kind === "horizontal") points[0] = { ...points[0], price: point.price };
    else points[drag.pointIndex] = point;
    const nextDraft = { ...drag.drawing, points };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  };

  const finishDrag = (event: ReactPointerEvent<SVGCircleElement | SVGLineElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const committedDraft = draftRef.current;
    if (committedDraft) {
      onCommit(drawings.map((drawing) => drawing.id === committedDraft.id ? committedDraft : drawing));
    }
    dragRef.current = null;
    draftRef.current = null;
    setDraft(null);
  };

  const coordinateForPoint = (point: MarketChartUserDrawingPoint) => {
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  };

  const pendingCoordinate = pendingPoint ? coordinateForPoint(pendingPoint) : null;
  const creating = tool === "horizontal" || tool === "trend" || tool === "measure";

  return (
    <svg
      ref={overlayRef}
      className={`ht-chart-user-drawings ${creating ? "is-creating" : ""}`}
      aria-label="User drawing layer"
      data-user-drawing-tool={tool}
      data-user-drawing-count={drawings.length}
      onPointerDown={createDrawing}
      onPointerMove={(event) => {
        if (!pendingPoint || (tool !== "trend" && tool !== "measure")) return;
        const point = pointFromEvent(event);
        if (point) {
          const nextDraft: MarketChartUserDrawing = { id: "pending", kind: tool, points: [pendingPoint, point] };
          draftRef.current = nextDraft;
          setDraft(nextDraft);
        }
      }}
    >
      {activeDrawings.map((drawing) => {
        const selected = drawing.id === selectedId;
        const first = coordinateForPoint(drawing.points[0]);
        const second = drawing.kind === "horizontal" ? null : coordinateForPoint(drawing.points[1]);
        if (!first || (drawing.kind !== "horizontal" && !second)) return null;
        const x1 = drawing.kind === "horizontal" ? 0 : first.x;
        const x2 = drawing.kind === "horizontal" ? "100%" : second?.x;
        const y2 = drawing.kind === "horizontal" ? first.y : second?.y;
        const firstPrice = drawing.points[0]?.price ?? 0;
        const secondPrice = drawing.points[1]?.price ?? firstPrice;
        const measurement = firstPrice === 0 ? 0 : ((secondPrice - firstPrice) / firstPrice) * 100;
        return (
          <g key={drawing.id} data-user-drawing-id={drawing.id}>
            {drawing.kind === "measure" && second ? (
              <rect
                x={Math.min(first.x, second.x)}
                y={Math.min(first.y, second.y)}
                width={Math.max(1, Math.abs(second.x - first.x))}
                height={Math.max(1, Math.abs(second.y - first.y))}
                className="ht-chart-user-drawings__measure"
              />
            ) : null}
            <line
              x1={x1}
              y1={first.y}
              x2={x2}
              y2={y2}
              className={`ht-chart-user-drawings__line ${selected ? "is-selected" : ""}`}
              aria-label={drawingLabel(drawing)}
              onPointerDown={(event) => beginDrag(event, drawing, 0)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onLostPointerCapture={finishDrag}
            />
            {drawing.kind === "measure" && second ? (
              <text x={(first.x + second.x) / 2} y={Math.min(first.y, second.y) - 8} textAnchor="middle" className="ht-chart-user-drawings__label">
                {measurement >= 0 ? "+" : ""}{measurement.toFixed(2)}%
              </text>
            ) : null}
            {selected ? drawing.points.map((point, index) => {
              const coordinate = coordinateForPoint(point);
              if (!coordinate) return null;
              return (
                <circle
                  key={`${drawing.id}-${index}`}
                  cx={drawing.kind === "horizontal" ? "50%" : coordinate.x}
                  cy={coordinate.y}
                  r="7"
                  className="ht-chart-user-drawings__handle"
                  onPointerDown={(event) => beginDrag(event, drawing, index)}
                  onPointerMove={moveDrag}
                  onPointerUp={finishDrag}
                  onLostPointerCapture={finishDrag}
                />
              );
            }) : null}
          </g>
        );
      })}
      {pendingCoordinate ? <circle cx={pendingCoordinate.x} cy={pendingCoordinate.y} r="6" className="ht-chart-user-drawings__pending" /> : null}
    </svg>
  );
}
