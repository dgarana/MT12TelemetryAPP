import { useEffect, useRef } from "react";
import type { FrameState, LayoutItem } from "../../shared/types";
import { renderFrame, type DrawCtx, type RunningStats } from "../../shared/widgetDraw";

interface Props {
  layout: Record<string, LayoutItem>;
  state: FrameState;
  runningStats?: RunningStats;
  timeMs: number;
  width: number;
  height: number;
  style?: React.CSSProperties;
  className?: string;
}

export function WidgetCanvas({ layout, state, runningStats = {}, timeMs, width, height, style, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d") as unknown as DrawCtx;
    if (!ctx) return;
    renderFrame(ctx, layout as Record<string, unknown>, state, runningStats, timeMs, width, height);
  }, [layout, state, runningStats, timeMs, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={style}
      className={className}
    />
  );
}
