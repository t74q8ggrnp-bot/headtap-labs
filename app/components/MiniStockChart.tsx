"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart } from "lightweight-charts";

type MiniStockChartProps = {
  symbol: string;
  price: number;
  change: number;
};

export default function MiniStockChart({
  symbol,
  price,
  change,
}: MiniStockChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 120,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "transparent" },
        horzLines: { color: "transparent" },
      },
      rightPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
      },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: change >= 0 ? "#fb923c" : "#f87171",
      topColor: change >= 0 ? "rgba(251, 146, 60, 0.35)" : "rgba(248, 113, 113, 0.30)",
      bottomColor: "rgba(0, 0, 0, 0)",
      lineWidth: 3,
    });

    const basePrice = price || 100;
    const direction = change >= 0 ? 1 : -1;

    const chartData = Array.from({ length: 24 }, (_, index) => {
      const wave = Math.sin(index / 2.3) * 0.8;
      const trend = direction * index * Math.abs(change || 1) * 0.035;
      const noise = Math.cos(index * 1.7) * 0.45;

      return {
        time: index as any,
        value: Number((basePrice + wave + trend + noise).toFixed(2)),
      };
    });

    series.setData(chartData);
    chart.timeScale().fitContent();

    const resizeChart = () => {
      if (!chartRef.current) return;

      chart.applyOptions({
        width: chartRef.current.clientWidth,
      });
    };

    window.addEventListener("resize", resizeChart);

    return () => {
      window.removeEventListener("resize", resizeChart);
      chart.remove();
    };
  }, [symbol, price, change]);

  return <div ref={chartRef} className="h-[120px] w-full" />;
}