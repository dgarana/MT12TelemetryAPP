import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { renderFrame, type DrawCtx, type FrameState, type RunningStats } from "../shared/widgetDraw";

export { type FrameState, type RunningStats };

export function makeCanvas(width: number, height: number): Canvas {
  return createCanvas(width, height);
}

export async function encodeCanvasPng(canvas: Canvas): Promise<Buffer> {
  return canvas.encode("png");
}

export function getRawFrame(canvas: Canvas): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = canvas.getContext("2d") as any;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height) as { data: Uint8ClampedArray };
  return Buffer.from(imageData.data.buffer);
}

export function renderFrameToCanvas(
  canvas: Canvas,
  layout: Record<string, unknown>,
  state: FrameState,
  runningStats: RunningStats,
  timeMs: number,
  frameWidth: number,
  frameHeight: number,
) {
  const ctx = canvas.getContext("2d") as unknown as DrawCtx;
  renderFrame(ctx, layout, state, runningStats, timeMs, frameWidth, frameHeight);
}
